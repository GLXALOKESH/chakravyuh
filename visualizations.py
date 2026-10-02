"""
Graph Visualization Helpers
Builds PyVis network graphs and Plotly charts for the Streamlit dashboard
"""

import pandas as pd
import numpy as np
import networkx as nx
import plotly.graph_objects as go
import plotly.express as px
from pyvis.network import Network
import streamlit as st
import tempfile
import os
import json


# ─── Color palette ────────────────────────────────────────────────────────────
RISK_COLORS = {
    "low":    "#00d2a0",   # teal
    "medium": "#f5a623",   # amber
    "high":   "#ff4b6e",   # red
    "fraud":  "#bf00ff",   # violet
}

ROLE_COLORS = {
    "Source":      "#00d2a0",
    "Coordinator": "#bf00ff",
    "Mule":        "#f5a623",
    "Relay":       "#ff7c40",
    "Cash-out":    "#ff4b6e",
    "Normal":      "#3a3f5c",
}


def risk_color(score):
    if score >= 75:   return RISK_COLORS["fraud"]
    elif score >= 50: return RISK_COLORS["high"]
    elif score >= 25: return RISK_COLORS["medium"]
    return RISK_COLORS["low"]


# ─── PyVis graph ──────────────────────────────────────────────────────────────
def build_pyvis_graph(
    accounts_df: pd.DataFrame,
    txns_df: pd.DataFrame,
    scored_df: pd.DataFrame,
    selected_accounts: list = None,
    max_nodes: int = 80,
    min_risk: float = 0,
) -> str:
    """
    Returns the path to a temporary HTML file containing the PyVis graph.
    """
    net = Network(
        height="600px", width="100%",
        bgcolor="#0d1117", font_color="#c9d1d9",
        directed=True,
    )
    net.set_options(json.dumps({
        "physics": {
            "enabled": True,
            "forceAtlas2Based": {
                "gravitationalConstant": -50,
                "centralGravity": 0.01,
                "springLength": 120,
                "springConstant": 0.08,
            },
            "solver": "forceAtlas2Based",
            "stabilization": {"iterations": 150},
        },
        "edges": {
            "arrows": {"to": {"enabled": True, "scaleFactor": 0.5}},
            "smooth": {"type": "curvedCW", "roundness": 0.2},
            "color": {"inherit": False},
        },
        "nodes": {
            "shape": "dot",
            "borderWidth": 2,
        },
        "interaction": {
            "hover": True,
            "navigationButtons": True,
            "keyboard": True,
        },
    }))

    score_map = dict(zip(scored_df["account_id"], scored_df["risk_score"]))
    role_map  = dict(zip(scored_df["account_id"], scored_df.get("role", {}).fillna("Normal")))

    # Filter by risk threshold
    candidates = scored_df[scored_df["risk_score"] >= min_risk]["account_id"].tolist()
    if selected_accounts:
        # Also include neighbors
        extra = set()
        for aid in selected_accounts:
            nb_out = set(txns_df[txns_df["source_account"] == aid]["dest_account"])
            nb_in  = set(txns_df[txns_df["dest_account"]   == aid]["source_account"])
            extra |= nb_out | nb_in
        candidates = list(set(candidates) | set(selected_accounts) | extra)

    if len(candidates) > max_nodes:
        # Prioritize highest risk
        priority = scored_df[scored_df["account_id"].isin(candidates)].nlargest(max_nodes, "risk_score")
        candidates = priority["account_id"].tolist()

    # Add nodes
    for aid in candidates:
        score = score_map.get(aid, 0)
        role  = role_map.get(aid, "Normal")
        color = risk_color(score)
        size  = 10 + score / 10
        title = (
            f"<b>{aid}</b><br>"
            f"Risk Score: <b>{score:.1f}</b><br>"
            f"Role: {role}<br>"
            f"Click to investigate"
        )
        net.add_node(aid, label=aid[:8], color=color, size=size, title=title)

    # Add edges
    edge_accs = set(candidates)
    agg = (txns_df[
        txns_df["source_account"].isin(edge_accs) &
        txns_df["dest_account"].isin(edge_accs)
    ].groupby(["source_account", "dest_account"])
     .agg(total=("amount", "sum"), count=("amount", "count"))
     .reset_index())

    for _, row in agg.iterrows():
        src_risk = score_map.get(row["source_account"], 0)
        dst_risk = score_map.get(row["dest_account"],   0)
        edge_risk = (src_risk + dst_risk) / 2
        ecolor = "#ff4b6e" if edge_risk > 60 else "#f5a623" if edge_risk > 30 else "#3a3f5c"
        width  = min(8, 1 + row["count"] / 5)
        net.add_edge(
            row["source_account"], row["dest_account"],
            color=ecolor, width=width,
            title=f"${row['total']:,.0f} ({int(row['count'])} txns)",
        )

    # Save to temp file
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".html")
    net.save_graph(tmp.name)
    tmp.close()
    return tmp.name


# ─── Risk distribution chart ──────────────────────────────────────────────────
def risk_distribution_chart(scored_df: pd.DataFrame) -> go.Figure:
    fig = px.histogram(
        scored_df, x="risk_score", nbins=40,
        color_discrete_sequence=["#bf00ff"],
        labels={"risk_score": "Risk Score", "count": "Accounts"},
        title="Risk Score Distribution",
    )
    fig.update_layout(
        paper_bgcolor="#0d1117", plot_bgcolor="#161b22",
        font=dict(color="#c9d1d9", family="Inter"),
        title_font_size=16,
        bargap=0.05,
        xaxis=dict(showgrid=False, zeroline=False),
        yaxis=dict(showgrid=True, gridcolor="#21262d", zeroline=False),
    )
    fig.add_vline(x=50, line_dash="dash", line_color="#f5a623",
                  annotation_text="Medium risk", annotation_font_color="#f5a623")
    fig.add_vline(x=75, line_dash="dash", line_color="#ff4b6e",
                  annotation_text="High risk", annotation_font_color="#ff4b6e")
    return fig


# ─── Volume over time ─────────────────────────────────────────────────────────
def volume_timeline_chart(txns_df: pd.DataFrame) -> go.Figure:
    df = txns_df.copy()
    df["date"] = pd.to_datetime(df["timestamp"]).dt.date
    daily = df.groupby(["date", "is_fraud"]).agg(
        volume=("amount", "sum"),
        count=("amount", "count")
    ).reset_index()

    fig = go.Figure()
    for is_fraud, label, color in [(False, "Legitimate", "#00d2a0"), (True, "Fraudulent", "#ff4b6e")]:
        d = daily[daily["is_fraud"] == is_fraud]
        fig.add_trace(go.Scatter(
            x=d["date"], y=d["volume"],
            mode="lines", name=label,
            line=dict(color=color, width=2),
            fill="tozeroy",
            fillcolor=f"{color}22",
        ))

    fig.update_layout(
        title="Daily Transaction Volume",
        paper_bgcolor="#0d1117", plot_bgcolor="#161b22",
        font=dict(color="#c9d1d9", family="Inter"),
        legend=dict(bgcolor="#0d1117"),
        xaxis=dict(showgrid=False),
        yaxis=dict(showgrid=True, gridcolor="#21262d", tickprefix="$"),
        hovermode="x unified",
    )
    return fig


# ─── Role pie chart ───────────────────────────────────────────────────────────
def role_donut_chart(scored_df: pd.DataFrame) -> go.Figure:
    counts = scored_df["role"].value_counts().reset_index()
    counts.columns = ["role", "count"]
    colors = [ROLE_COLORS.get(r, "#888") for r in counts["role"]]

    fig = go.Figure(go.Pie(
        labels=counts["role"], values=counts["count"],
        hole=0.55,
        marker=dict(colors=colors, line=dict(color="#0d1117", width=2)),
        textfont=dict(color="#c9d1d9"),
    ))
    fig.update_layout(
        title="Account Role Distribution",
        paper_bgcolor="#0d1117",
        font=dict(color="#c9d1d9", family="Inter"),
        legend=dict(bgcolor="#0d1117"),
        showlegend=True,
    )
    return fig


# ─── Geographic heatmap ───────────────────────────────────────────────────────
def geo_scatter_chart(txns_df: pd.DataFrame, scored_df: pd.DataFrame) -> go.Figure:
    df = txns_df.copy()
    # Attach risk of source account
    risk_map = dict(zip(scored_df["account_id"], scored_df["risk_score"]))
    df["risk"] = df["source_account"].map(risk_map).fillna(0)

    # Sample for performance
    sample = df.sample(min(3000, len(df)), random_state=42)

    fig = px.scatter_geo(
        sample,
        lat="lat", lon="lon",
        color="risk",
        color_continuous_scale=[[0, "#00d2a0"], [0.5, "#f5a623"], [1, "#ff4b6e"]],
        size="amount",
        size_max=15,
        scope="usa",
        hover_data={"lat": False, "lon": False, "amount": ":$,.0f", "risk": ":.0f"},
        labels={"risk": "Risk Score", "amount": "Amount"},
        title="Geographic Transaction Map",
    )
    fig.update_layout(
        paper_bgcolor="#0d1117",
        geo=dict(bgcolor="#161b22", lakecolor="#0d1117",
                 landcolor="#21262d", subunitcolor="#30363d"),
        font=dict(color="#c9d1d9", family="Inter"),
        coloraxis_colorbar=dict(title="Risk", tickfont=dict(color="#c9d1d9")),
    )
    return fig


# ─── Timeline for a single account ───────────────────────────────────────────
def account_timeline(account_id: str, txns_df: pd.DataFrame,
                     scored_df: pd.DataFrame) -> go.Figure:
    sent = txns_df[txns_df["source_account"] == account_id].copy()
    recv = txns_df[txns_df["dest_account"]   == account_id].copy()
    sent["direction"] = "Out"
    sent["amount_signed"] = -sent["amount"]
    sent["counterparty"] = sent["dest_account"]
    recv["direction"] = "In"
    recv["amount_signed"] = recv["amount"]
    recv["counterparty"] = recv["source_account"]

    df = pd.concat([sent, recv]).sort_values("timestamp")
    if df.empty:
        return go.Figure()

    risk_map = dict(zip(scored_df["account_id"], scored_df["risk_score"]))
    df["cp_risk"] = df["counterparty"].map(risk_map).fillna(0)
    df["color"]   = df["cp_risk"].apply(lambda r: risk_color(r))

    fig = go.Figure()
    for direction, color, sign in [("In", "#00d2a0", 1), ("Out", "#ff4b6e", -1)]:
        subset = df[df["direction"] == direction]
        fig.add_trace(go.Bar(
            x=subset["timestamp"],
            y=subset["amount"] * sign,
            name=direction,
            marker_color=color,
            hovertemplate=(
                "<b>%{x}</b><br>"
                "Amount: $%{customdata[0]:,.0f}<br>"
                "Counterparty: %{customdata[1]}<br>"
                "Cp Risk: %{customdata[2]:.0f}<extra></extra>"
            ),
            customdata=subset[["amount", "counterparty", "cp_risk"]].values,
        ))

    fig.update_layout(
        title=f"Transaction Timeline — {account_id}",
        barmode="overlay",
        paper_bgcolor="#0d1117", plot_bgcolor="#161b22",
        font=dict(color="#c9d1d9", family="Inter"),
        xaxis=dict(showgrid=False),
        yaxis=dict(showgrid=True, gridcolor="#21262d", tickprefix="$"),
        legend=dict(bgcolor="#0d1117"),
    )
    return fig


# ─── Community risk bar ───────────────────────────────────────────────────────
def community_risk_bar(comm_df: pd.DataFrame) -> go.Figure:
    top = comm_df.nlargest(20, "fraud_density")
    colors = ["#ff4b6e" if s else "#3a3f5c" for s in top["is_suspicious"]]

    fig = go.Figure(go.Bar(
        x=top["community_id"].astype(str),
        y=top["fraud_density"],
        marker_color=colors,
        text=(top["fraud_density"] * 100).round(0).astype(str) + "%",
        textposition="outside",
        hovertemplate=(
            "Community %{x}<br>"
            "Fraud Density: %{y:.0%}<br>"
            "Nodes: %{customdata[0]}<br>"
            "Volume: $%{customdata[1]:,.0f}<extra></extra>"
        ),
        customdata=top[["size", "internal_volume"]].values,
    ))
    fig.update_layout(
        title="Top Communities by Fraud Density",
        paper_bgcolor="#0d1117", plot_bgcolor="#161b22",
        font=dict(color="#c9d1d9", family="Inter"),
        xaxis=dict(title="Community ID", showgrid=False),
        yaxis=dict(title="Fraud Density", showgrid=True, gridcolor="#21262d",
                   tickformat=".0%"),
    )
    return fig


# ─── Feature importance chart ─────────────────────────────────────────────────
def feature_importance_chart(fi_path: str = "models/feature_importances.json") -> go.Figure:
    if not os.path.exists(fi_path):
        return go.Figure()
    with open(fi_path) as f:
        fi = json.load(f)
    df = pd.DataFrame(list(fi.items()), columns=["feature", "importance"])
    df = df.sort_values("importance", ascending=True).tail(15)

    fig = go.Figure(go.Bar(
        x=df["importance"], y=df["feature"],
        orientation="h",
        marker=dict(
            color=df["importance"],
            colorscale=[[0, "#3a3f5c"], [1, "#bf00ff"]],
        ),
    ))
    fig.update_layout(
        title="Top Feature Importances (XGBoost)",
        paper_bgcolor="#0d1117", plot_bgcolor="#161b22",
        font=dict(color="#c9d1d9", family="Inter"),
        xaxis=dict(showgrid=True, gridcolor="#21262d"),
        yaxis=dict(showgrid=False),
    )
    return fig
