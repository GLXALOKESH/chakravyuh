"""
FraudGraph — Coordinated Financial Fraud Detection Dashboard
Hackathon: Detecting Coordinated Financial Fraud Through Heterogeneous
           Identity and Transaction Graphs
"""

import streamlit as st
import pandas as pd
import numpy as np
import os, json, time
import streamlit.components.v1 as components

# ── Page config MUST be first ──────────────────────────────────────────────────
st.set_page_config(
    page_title="FraudGraph — Fraud Intelligence Dashboard",
    page_icon="🕵️",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Inject custom CSS ─────────────────────────────────────────────────────────
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap');

/* Global resets */
*, *::before, *::after { box-sizing: border-box; }

html, body, .stApp {
    background: #0a0e1a !important;
    font-family: 'Inter', sans-serif !important;
    color: #c9d1d9 !important;
}

/* Sidebar */
[data-testid="stSidebar"] {
    background: #0d1117 !important;
    border-right: 1px solid #21262d !important;
}
[data-testid="stSidebar"] * { color: #c9d1d9 !important; }

/* Metric cards */
.metric-card {
    background: linear-gradient(135deg, #161b22 0%, #0d1117 100%);
    border: 1px solid #21262d;
    border-radius: 12px;
    padding: 20px 24px;
    transition: border-color .2s, transform .2s;
    position: relative;
    overflow: hidden;
}
.metric-card::before {
    content: '';
    position: absolute;
    top: 0; left: 0;
    width: 4px; height: 100%;
    border-radius: 12px 0 0 12px;
}
.metric-card.teal::before   { background: #00d2a0; }
.metric-card.amber::before  { background: #f5a623; }
.metric-card.red::before    { background: #ff4b6e; }
.metric-card.violet::before { background: #bf00ff; }
.metric-card.blue::before   { background: #58a6ff; }

.metric-card:hover {
    border-color: #388bfd;
    transform: translateY(-2px);
}
.metric-label {
    font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 1px;
    color: #8b949e !important; margin-bottom: 6px;
}
.metric-value {
    font-size: 32px; font-weight: 700;
    color: #f0f6fc !important;
    font-family: 'JetBrains Mono', monospace;
}
.metric-sub {
    font-size: 12px; color: #8b949e !important; margin-top: 4px;
}

/* Alert / explanation cards */
.alert-card {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 10px;
    padding: 16px 20px;
    margin-bottom: 10px;
    border-left: 3px solid #ff4b6e;
}
.alert-card.warning { border-left-color: #f5a623; }
.alert-card.info    { border-left-color: #58a6ff; }
.alert-card.ok      { border-left-color: #00d2a0; }

/* Risk badge */
.risk-badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 20px;
    font-size: 12px; font-weight: 600;
    font-family: 'JetBrains Mono', monospace;
}
.risk-low    { background: #00d2a022; color: #00d2a0; border: 1px solid #00d2a044; }
.risk-medium { background: #f5a62322; color: #f5a623; border: 1px solid #f5a62344; }
.risk-high   { background: #ff4b6e22; color: #ff4b6e; border: 1px solid #ff4b6e44; }
.risk-fraud  { background: #bf00ff22; color: #bf00ff; border: 1px solid #bf00ff44; }

/* Section headers */
.section-header {
    font-size: 18px; font-weight: 600;
    color: #f0f6fc;
    margin: 24px 0 16px;
    display: flex; align-items: center; gap: 8px;
}
.section-header::after {
    content: '';
    flex: 1;
    height: 1px;
    background: linear-gradient(90deg, #21262d, transparent);
}

/* Role chips */
.role-chip {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.5px;
}

/* Table overrides */
[data-testid="stDataFrame"] { background: #161b22 !important; }
.stDataFrame th { background: #21262d !important; color: #8b949e !important; }
.stDataFrame td { color: #c9d1d9 !important; }

/* Buttons */
.stButton > button {
    background: linear-gradient(135deg, #bf00ff, #7c3aed) !important;
    color: #fff !important;
    border: none !important;
    border-radius: 8px !important;
    font-weight: 600 !important;
    padding: 8px 20px !important;
    transition: opacity .2s !important;
}
.stButton > button:hover { opacity: 0.85 !important; }

/* Tabs */
.stTabs [role="tab"] {
    color: #8b949e !important;
    font-weight: 500 !important;
}
.stTabs [role="tab"][aria-selected="true"] {
    color: #bf00ff !important;
    border-bottom-color: #bf00ff !important;
}

/* Selectbox / sliders */
.stSelectbox label, .stSlider label { color: #8b949e !important; font-size: 13px !important; }

/* Hide default Streamlit footer */
footer { visibility: hidden; }

/* Glow effect for high-risk items */
@keyframes glow-pulse {
    0%, 100% { box-shadow: 0 0 6px #ff4b6e66; }
    50%       { box-shadow: 0 0 18px #ff4b6eaa; }
}
.glow-red { animation: glow-pulse 2s ease-in-out infinite; }
</style>
""", unsafe_allow_html=True)


# ── Helpers ───────────────────────────────────────────────────────────────────
DATA_PATH   = "data"
MODELS_PATH = "models"

@st.cache_data(show_spinner=False)
def load_data():
    txns    = pd.read_csv(f"{DATA_PATH}/transactions.csv", parse_dates=["timestamp"])
    accs    = pd.read_csv(f"{DATA_PATH}/accounts.csv")
    scored  = pd.read_csv(f"{DATA_PATH}/account_scores.csv")
    comms   = pd.read_csv(f"{DATA_PATH}/communities.csv")
    cust    = pd.read_csv(f"{DATA_PATH}/customers.csv")
    idlinks = pd.read_csv(f"{DATA_PATH}/identity_links.csv")
    with open(f"{DATA_PATH}/stats.json") as f:
        stats = json.load(f)
    return txns, accs, scored, comms, cust, idlinks, stats


def risk_class(score):
    if score >= 75:  return "fraud",  "risk-fraud"
    if score >= 50:  return "high",   "risk-high"
    if score >= 25:  return "medium", "risk-medium"
    return "low", "risk-low"


def metric_card(label, value, sub="", color="teal"):
    st.markdown(f"""
    <div class="metric-card {color}">
        <div class="metric-label">{label}</div>
        <div class="metric-value">{value}</div>
        <div class="metric-sub">{sub}</div>
    </div>""", unsafe_allow_html=True)


# ── Check data / run pipeline if needed ───────────────────────────────────────
def ensure_data():
    if not os.path.exists(f"{DATA_PATH}/account_scores.csv"):
        with st.spinner("🔄 Generating synthetic dataset and training models — please wait (~60s)…"):
            import data_generator as dg
            dg.generate_all(DATA_PATH)
        with st.spinner("🧠 Running fraud detection pipeline…"):
            import fraud_engine as fe
            fe.run_pipeline(DATA_PATH, MODELS_PATH, DATA_PATH)
        st.success("✅ Ready!")
        st.rerun()


# ═══════════════════════════════════════════════════════════════════════════════
#  SIDEBAR
# ═══════════════════════════════════════════════════════════════════════════════
def render_sidebar(scored_df, comms_df):
    with st.sidebar:
        st.markdown("""
        <div style='text-align:center; padding: 20px 0 10px;'>
            <div style='font-size:40px;'>🕵️</div>
            <div style='font-size:20px; font-weight:700; color:#f0f6fc; letter-spacing:1px;'>FraudGraph</div>
            <div style='font-size:11px; color:#8b949e; letter-spacing:2px; text-transform:uppercase;'>
                Intelligence Platform
            </div>
        </div>
        <hr style='border-color:#21262d; margin:10px 0 20px;'/>
        """, unsafe_allow_html=True)

        page = st.radio(
            "Navigation",
            ["📊 Overview", "🕸️ Network Explorer", "🔍 Account Investigator",
             "🗺️ Geographic Intelligence", "📈 Analytics", "⚠️ Early Warning"],
            label_visibility="collapsed",
        )

        st.markdown("<hr style='border-color:#21262d; margin:16px 0;'/>", unsafe_allow_html=True)
        st.markdown("<div style='font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;'>Filters</div>", unsafe_allow_html=True)

        min_risk = st.slider("Min Risk Score", 0, 100, 0, key="sidebar_min_risk")
        show_fraud_only = st.checkbox("Confirmed Fraud Only", value=False)

        suspicious_n = int((scored_df["risk_score"] >= 75).sum())
        st.markdown(f"""
        <div style='margin-top:20px; padding:12px; background:#1a0a2e; border-radius:8px;
                    border:1px solid #bf00ff33;'>
            <div style='font-size:11px;color:#8b949e;'>HIGH RISK ACCOUNTS</div>
            <div style='font-size:28px;font-weight:700;color:#bf00ff;
                        font-family:"JetBrains Mono",monospace;'>{suspicious_n}</div>
        </div>
        """, unsafe_allow_html=True)

        st.markdown("<hr style='border-color:#21262d; margin:16px 0;'/>", unsafe_allow_html=True)

        if st.button("🔄 Re-run Pipeline"):
            for f in ["account_scores.csv", "communities.csv"]:
                path = f"{DATA_PATH}/{f}"
                if os.path.exists(path):
                    os.remove(path)
            st.cache_data.clear()
            st.rerun()

        st.markdown("""
        <div style='margin-top:auto;padding-top:20px;font-size:10px;color:#484f58;text-align:center;'>
            CRYPT RC · 32-Hour Hackathon<br/>
            Built with ❤️ using Python + Streamlit
        </div>
        """, unsafe_allow_html=True)

    return page, min_risk, show_fraud_only


# ═══════════════════════════════════════════════════════════════════════════════
#  PAGE: OVERVIEW
# ═══════════════════════════════════════════════════════════════════════════════
def page_overview(txns_df, accs_df, scored_df, comms_df, stats):
    st.markdown("""
    <div style='padding:24px 0 8px;'>
        <div style='font-size:28px;font-weight:700;color:#f0f6fc;'>
            🕵️ Fraud Intelligence Overview
        </div>
        <div style='color:#8b949e;font-size:14px;margin-top:4px;'>
            Real-time coordinated fraud network detection across identity & transaction graphs
        </div>
    </div>
    """, unsafe_allow_html=True)

    # ── KPI metrics ──────────────────────────────────────────────────────────
    c1, c2, c3, c4, c5 = st.columns(5)
    with c1:
        metric_card("Total Transactions", f"{len(txns_df):,}",
                    f"{txns_df['amount'].sum():,.0f} total USD", "teal")
    with c2:
        metric_card("Total Accounts", f"{stats['n_accounts']:,}",
                    f"{stats['n_customers']:,} customers", "blue")
    with c3:
        sus = int((scored_df["risk_score"] >= 50).sum())
        metric_card("Suspicious Accounts", f"{sus:,}",
                    f"{sus/stats['n_accounts']*100:.1f}% of all accounts", "amber")
    with c4:
        fraud_n = int((scored_df["risk_score"] >= 75).sum())
        metric_card("High-Risk Accounts", f"{fraud_n:,}",
                    "Risk score ≥ 75", "red")
    with c5:
        sus_vol = txns_df[txns_df["is_fraud"]]["amount"].sum()
        metric_card("Suspicious Volume", f"${sus_vol/1e6:.2f}M",
                    "Confirmed fraud transactions", "violet")

    st.markdown("<br/>", unsafe_allow_html=True)

    # ── Charts row ────────────────────────────────────────────────────────────
    from visualizations import (
        risk_distribution_chart, volume_timeline_chart,
        role_donut_chart, community_risk_bar, feature_importance_chart
    )

    col1, col2 = st.columns([3, 2])
    with col1:
        st.plotly_chart(volume_timeline_chart(txns_df), width='stretch')
    with col2:
        st.plotly_chart(risk_distribution_chart(scored_df), width='stretch')

    col3, col4, col5 = st.columns(3)
    with col3:
        st.plotly_chart(role_donut_chart(scored_df), width='stretch')
    with col4:
        st.plotly_chart(community_risk_bar(comms_df), width='stretch')
    with col5:
        st.plotly_chart(feature_importance_chart(), width='stretch')

    # ── Fraud ring table ──────────────────────────────────────────────────────
    st.markdown('<div class="section-header">🔴 Active Fraud Rings</div>', unsafe_allow_html=True)
    ring_df = (scored_df[scored_df["ring_id"].notna()]
               .groupby("ring_id")
               .agg(
                   accounts=("account_id", "count"),
                   avg_risk=("risk_score", "mean"),
                   max_risk=("risk_score", "max"),
                   fraud_type=("fraud_type", "first"),
               )
               .reset_index()
               .sort_values("avg_risk", ascending=False))
    if not ring_df.empty:
        ring_df["avg_risk"] = ring_df["avg_risk"].round(1)
        ring_df["max_risk"] = ring_df["max_risk"].round(1)
        ring_df.columns = ["Ring ID", "Accounts", "Avg Risk", "Max Risk", "Fraud Type"]
        st.dataframe(ring_df, width='stretch', hide_index=True)

    # ── Recent high-risk alerts ───────────────────────────────────────────────
    st.markdown('<div class="section-header">🚨 Recent High-Risk Alerts</div>', unsafe_allow_html=True)
    alerts = scored_df[scored_df["risk_score"] >= 70].sort_values("risk_score", ascending=False).head(8)
    for _, row in alerts.iterrows():
        level, css = risk_class(row["risk_score"])
        expl = str(row.get("explanations", "")).split(" | ")[0] if pd.notna(row.get("explanations")) else "Anomaly detected"
        col_badge, col_desc = st.columns([1, 6])
        with col_badge:
            st.markdown(f'<span class="risk-badge {css}">{row["risk_score"]:.0f}</span>',
                        unsafe_allow_html=True)
        with col_desc:
            st.markdown(
                f'**{row["account_id"]}** — {row.get("role","?")} '
                f'· Ring: `{row.get("ring_id","—")}` '
                f'· _{expl}_'
            )


# ═══════════════════════════════════════════════════════════════════════════════
#  PAGE: NETWORK EXPLORER
# ═══════════════════════════════════════════════════════════════════════════════
def page_network(txns_df, scored_df, accs_df, min_risk):
    from visualizations import build_pyvis_graph

    st.markdown("""
    <div style='padding:16px 0 8px;'>
        <div style='font-size:24px;font-weight:700;color:#f0f6fc;'>🕸️ Network Explorer</div>
        <div style='color:#8b949e;font-size:13px;'>
            Interactive transaction graph — node size = risk, color = risk level
        </div>
    </div>
    """, unsafe_allow_html=True)

    col_ctrl1, col_ctrl2, col_ctrl3 = st.columns(3)
    with col_ctrl1:
        max_nodes = st.slider("Max nodes to display", 20, 150, 60, key="net_max_nodes")
    with col_ctrl2:
        ring_options = ["All"] + sorted(scored_df["ring_id"].dropna().unique().tolist())
        selected_ring = st.selectbox("Filter by Ring", ring_options, key="net_ring")
    with col_ctrl3:
        role_opts = ["All"] + sorted(scored_df["role"].dropna().unique().tolist())
        selected_role = st.selectbox("Filter by Role", role_opts, key="net_role")

    # Determine selected accounts
    filtered = scored_df.copy()
    if selected_ring != "All":
        filtered = filtered[filtered["ring_id"] == selected_ring]
    if selected_role != "All":
        filtered = filtered[filtered["role"] == selected_role]
    filtered = filtered[filtered["risk_score"] >= min_risk]

    selected_accounts = filtered["account_id"].tolist()

    with st.spinner("Building network graph…"):
        html_path = build_pyvis_graph(
            accs_df, txns_df, scored_df,
            selected_accounts=selected_accounts,
            max_nodes=max_nodes,
            min_risk=min_risk,
        )

    with open(html_path, "r", encoding="utf-8") as f:
        html_content = f.read()
    components.html(html_content, height=630, scrolling=False)
    os.unlink(html_path)

    # Legend
    st.markdown("""
    <div style='display:flex;gap:20px;margin-top:8px;flex-wrap:wrap;'>
        <span style='font-size:12px;color:#00d2a0;'>● Low risk (&lt;25)</span>
        <span style='font-size:12px;color:#f5a623;'>● Medium risk (25–50)</span>
        <span style='font-size:12px;color:#ff4b6e;'>● High risk (50–75)</span>
        <span style='font-size:12px;color:#bf00ff;'>● Critical (≥75)</span>
        <span style='font-size:12px;color:#8b949e;margin-left:20px;'>
            Node size ∝ risk score · Edge width ∝ transaction count
        </span>
    </div>
    """, unsafe_allow_html=True)

    # Network stats
    c1, c2, c3 = st.columns(3)
    with c1:
        st.metric("Nodes shown", len(selected_accounts[:max_nodes]))
    with c2:
        edge_count = len(txns_df[
            txns_df["source_account"].isin(selected_accounts) &
            txns_df["dest_account"].isin(selected_accounts)
        ])
        st.metric("Edges shown", edge_count)
    with c3:
        avg_r = filtered["risk_score"].mean() if not filtered.empty else 0
        st.metric("Avg Risk Score", f"{avg_r:.1f}")


# ═══════════════════════════════════════════════════════════════════════════════
#  PAGE: ACCOUNT INVESTIGATOR
# ═══════════════════════════════════════════════════════════════════════════════
def page_investigator(txns_df, scored_df, accs_df, idlinks_df, cust_df):
    from visualizations import account_timeline

    st.markdown("""
    <div style='padding:16px 0 8px;'>
        <div style='font-size:24px;font-weight:700;color:#f0f6fc;'>🔍 Account Investigator</div>
        <div style='color:#8b949e;font-size:13px;'>Deep-dive into any account's risk profile and network connections</div>
    </div>
    """, unsafe_allow_html=True)

    # Account selector — prioritize high-risk
    high_risk = scored_df.nlargest(200, "risk_score")["account_id"].tolist()
    all_accs  = scored_df["account_id"].tolist()
    ordered   = high_risk + [a for a in all_accs if a not in high_risk]

    selected_acc = st.selectbox(
        "Select Account ID (sorted by risk)",
        ordered,
        format_func=lambda aid: (
            f"{aid}  [{scored_df[scored_df['account_id']==aid]['risk_score'].values[0]:.0f} risk]"
        ),
        key="inv_account",
    )

    if not selected_acc:
        return

    row = scored_df[scored_df["account_id"] == selected_acc].iloc[0]
    level, css = risk_class(row["risk_score"])

    # ── Header card ───────────────────────────────────────────────────────────
    role_colors_map = {
        "Source": "#00d2a0", "Coordinator": "#bf00ff", "Mule": "#f5a623",
        "Relay": "#ff7c40", "Cash-out": "#ff4b6e", "Normal": "#8b949e",
    }
    role_col = role_colors_map.get(str(row.get("role", "Normal")), "#8b949e")

    st.markdown(f"""
    <div style='background:#161b22;border:1px solid #30363d;border-radius:14px;
                padding:24px;margin-bottom:20px;'>
        <div style='display:flex;justify-content:space-between;align-items:flex-start;'>
            <div>
                <div style='font-size:22px;font-weight:700;color:#f0f6fc;'>{selected_acc}</div>
                <div style='margin-top:6px;display:flex;gap:10px;align-items:center;'>
                    <span class="risk-badge {css}">Risk: {row['risk_score']:.0f}</span>
                    <span class="role-chip" style='background:{role_col}22;color:{role_col};
                          border:1px solid {role_col}44;'>{row.get('role','?')}</span>
                    {'<span style="color:#ff4b6e;font-size:12px;font-weight:600;">⚠️ FRAUD RING: '+str(row.get('ring_id',''))+'</span>' if pd.notna(row.get('ring_id')) else ''}
                </div>
            </div>
            <div style='text-align:right;'>
                <div style='font-size:11px;color:#8b949e;'>XGBoost</div>
                <div style='font-size:20px;font-weight:700;color:#58a6ff;font-family:"JetBrains Mono",monospace;'>
                    {row.get('xgb_proba',0):.0f}%
                </div>
                <div style='font-size:11px;color:#8b949e;margin-top:6px;'>Isolation Forest</div>
                <div style='font-size:18px;font-weight:600;color:#f5a623;font-family:"JetBrains Mono",monospace;'>
                    {row.get('iso_score',0):.0f}%
                </div>
            </div>
        </div>
    </div>
    """, unsafe_allow_html=True)

    # ── Tabs ──────────────────────────────────────────────────────────────────
    tab1, tab2, tab3, tab4 = st.tabs(["📋 Profile", "⚠️ Why Flagged", "📊 Timeline", "🔗 Connections"])

    with tab1:
        c1, c2, c3 = st.columns(3)
        with c1:
            st.markdown("**Behavioral Metrics**")
            metrics = {
                "Sent (n)": f"{int(row.get('n_sent',0)):,}",
                "Received (n)": f"{int(row.get('n_recv',0)):,}",
                "Amount Sent": f"${row.get('amt_sent',0):,.0f}",
                "Amount Received": f"${row.get('amt_recv',0):,.0f}",
                "Total Volume": f"${row.get('total_volume',0):,.0f}",
                "Pass-Through Ratio": f"{row.get('pass_through',0):.0%}",
            }
            for k, v in metrics.items():
                st.markdown(f"<div style='display:flex;justify-content:space-between;padding:4px 0;"
                            f"border-bottom:1px solid #21262d;'>"
                            f"<span style='color:#8b949e;font-size:13px;'>{k}</span>"
                            f"<span style='font-weight:600;font-size:13px;'>{v}</span>"
                            f"</div>", unsafe_allow_html=True)

        with c2:
            st.markdown("**Graph Metrics**")
            graph_metrics = {
                "PageRank":         f"{row.get('pagerank',0):.5f}",
                "Betweenness":      f"{row.get('betweenness',0):.5f}",
                "In-Degree (wt)":   f"{row.get('in_degree_w',0):,.0f}",
                "Out-Degree (wt)":  f"{row.get('out_degree_w',0):,.0f}",
                "Shared Devices":   f"{int(row.get('shared_devices',0))}",
                "Shared IPs":       f"{int(row.get('shared_ips',0))}",
                "Unique Outgoing":  f"{int(row.get('unique_out',0))}",
                "Unique Incoming":  f"{int(row.get('unique_in',0))}",
            }
            for k, v in graph_metrics.items():
                st.markdown(f"<div style='display:flex;justify-content:space-between;padding:4px 0;"
                            f"border-bottom:1px solid #21262d;'>"
                            f"<span style='color:#8b949e;font-size:13px;'>{k}</span>"
                            f"<span style='font-weight:600;font-size:13px;'>{v}</span>"
                            f"</div>", unsafe_allow_html=True)

        with c3:
            st.markdown("**Activity Metrics**")
            act_metrics = {
                "Velocity (txn/day)": f"{row.get('velocity',0):.1f}",
                "Burst Score":        f"{int(row.get('burst_score',0))}",
                "Avg Delay (h)":      f"{row.get('avg_delay_h',0):.1f}",
                "Large Tx Ratio":     f"{row.get('large_tx_ratio',0):.0%}",
                "Account Age (days)": f"{int(row.get('age_days',0))}",
                "Community ID":       f"{row.get('community_id','?')}",
                "Fraud Type":         str(row.get('fraud_type','—')),
                "Recruitment Risk":   f"{row.get('recruitment_risk',0):.0f}%",
            }
            for k, v in act_metrics.items():
                st.markdown(f"<div style='display:flex;justify-content:space-between;padding:4px 0;"
                            f"border-bottom:1px solid #21262d;'>"
                            f"<span style='color:#8b949e;font-size:13px;'>{k}</span>"
                            f"<span style='font-weight:600;font-size:13px;'>{v}</span>"
                            f"</div>", unsafe_allow_html=True)

    with tab2:
        st.markdown("### 🔎 Why was this account flagged?")
        explanations = str(row.get("explanations", "")).split(" | ")
        for expl in explanations:
            if expl.strip():
                st.markdown(f"""
                <div class="alert-card">
                    <span style='font-size:15px;'>{expl.strip()}</span>
                </div>""", unsafe_allow_html=True)

        # Risk gauge
        import plotly.graph_objects as go
        gauge = go.Figure(go.Indicator(
            mode="gauge+number+delta",
            value=row["risk_score"],
            delta={"reference": 50, "valueformat": ".0f"},
            gauge={
                "axis": {"range": [0, 100], "tickcolor": "#8b949e"},
                "bar":  {"color": "#bf00ff" if row["risk_score"] >= 75 else
                                  "#ff4b6e" if row["risk_score"] >= 50 else
                                  "#f5a623" if row["risk_score"] >= 25 else "#00d2a0"},
                "bgcolor": "#161b22",
                "steps": [
                    {"range": [0,  25], "color": "#00d2a011"},
                    {"range": [25, 50], "color": "#f5a62311"},
                    {"range": [50, 75], "color": "#ff4b6e11"},
                    {"range": [75,100], "color": "#bf00ff22"},
                ],
                "threshold": {"line": {"color": "#ff4b6e", "width": 3}, "value": 75},
            },
            title={"text": "Composite Risk Score", "font": {"color": "#c9d1d9"}},
            number={"font": {"color": "#f0f6fc", "size": 48}},
        ))
        gauge.update_layout(
            paper_bgcolor="#0d1117",
            font=dict(color="#c9d1d9", family="Inter"),
            height=280,
        )
        st.plotly_chart(gauge, width='stretch')

    with tab3:
        st.plotly_chart(account_timeline(selected_acc, txns_df, scored_df),
                        width='stretch')

        # Chronological table
        st.markdown("**Chronological money movement**")
        acc_txns = txns_df[
            (txns_df["source_account"] == selected_acc) |
            (txns_df["dest_account"]   == selected_acc)
        ].sort_values("timestamp").head(50)
        if not acc_txns.empty:
            display = acc_txns[["timestamp","source_account","dest_account",
                                 "amount","transaction_type","city","is_fraud"]].copy()
            display["amount"] = display["amount"].apply(lambda x: f"${x:,.2f}")
            display["is_fraud"] = display["is_fraud"].apply(lambda x: "🔴" if x else "✅")
            st.dataframe(display, width='stretch', hide_index=True)

    with tab4:
        # 1st-degree neighbors
        nb_out = txns_df[txns_df["source_account"] == selected_acc]["dest_account"].unique()
        nb_in  = txns_df[txns_df["dest_account"]   == selected_acc]["source_account"].unique()
        all_nb = set(nb_out) | set(nb_in)

        st.markdown(f"**{len(all_nb)} direct neighbors** · "
                    f"{len(nb_out)} outgoing · {len(nb_in)} incoming")

        risk_map = dict(zip(scored_df["account_id"], scored_df["risk_score"]))
        role_map = dict(zip(scored_df["account_id"], scored_df["role"].fillna("Normal")))

        nb_rows = []
        for nb in list(all_nb)[:50]:
            nb_rows.append({
                "Account": nb,
                "Risk":    risk_map.get(nb, 0),
                "Role":    role_map.get(nb, "?"),
                "Direction": "↑ Out" if nb in nb_out else "↓ In",
                "Txns": len(txns_df[
                    ((txns_df["source_account"]==selected_acc) & (txns_df["dest_account"]==nb)) |
                    ((txns_df["dest_account"]==selected_acc)   & (txns_df["source_account"]==nb))
                ]),
            })
        nb_df = pd.DataFrame(nb_rows).sort_values("Risk", ascending=False)
        st.dataframe(nb_df, width='stretch', hide_index=True)

        # Identity links
        st.markdown("**Identity Infrastructure**")
        acc_links = idlinks_df[idlinks_df["account_id"] == selected_acc]
        for _, lrow in acc_links.iterrows():
            etype = lrow["entity_type"]
            eid   = lrow["entity_id"]
            # How many other accounts share this entity?
            sharing = idlinks_df[
                (idlinks_df["entity_type"] == etype) &
                (idlinks_df["entity_id"]   == eid) &
                (idlinks_df["account_id"] != selected_acc)
            ]
            share_count = len(sharing)
            color = "🔴" if share_count > 2 else "🟡" if share_count > 0 else "🟢"
            st.markdown(f"{color} **{etype.upper()}** `{eid}` — "
                        f"shared with **{share_count}** other account(s)")


# ═══════════════════════════════════════════════════════════════════════════════
#  PAGE: GEOGRAPHIC INTELLIGENCE
# ═══════════════════════════════════════════════════════════════════════════════
def page_geo(txns_df, scored_df):
    from visualizations import geo_scatter_chart
    st.markdown("""
    <div style='padding:16px 0 8px;'>
        <div style='font-size:24px;font-weight:700;color:#f0f6fc;'>🗺️ Geographic Intelligence</div>
        <div style='color:#8b949e;font-size:13px;'>Spatial distribution of transactions with risk overlay</div>
    </div>
    """, unsafe_allow_html=True)

    fig = geo_scatter_chart(txns_df, scored_df)
    st.plotly_chart(fig, width='stretch')

    # City-level fraud stats
    st.markdown('<div class="section-header">📍 Fraud by City</div>', unsafe_allow_html=True)
    fraud_txns = txns_df[txns_df["is_fraud"]]
    city_stats = (fraud_txns.groupby("city")
                  .agg(fraud_txns_n=("amount","count"),
                       fraud_volume=("amount","sum"))
                  .reset_index()
                  .sort_values("fraud_volume", ascending=False))
    city_stats["fraud_volume"] = city_stats["fraud_volume"].apply(lambda x: f"${x:,.0f}")
    st.dataframe(city_stats, width='stretch', hide_index=True)


# ═══════════════════════════════════════════════════════════════════════════════
#  PAGE: ANALYTICS
# ═══════════════════════════════════════════════════════════════════════════════
def page_analytics(txns_df, scored_df, comms_df, accs_df):
    import plotly.express as px
    import plotly.graph_objects as go

    st.markdown("""
    <div style='padding:16px 0 8px;'>
        <div style='font-size:24px;font-weight:700;color:#f0f6fc;'>📈 Analytics & Insights</div>
        <div style='color:#8b949e;font-size:13px;'>Deep analysis of fraud patterns and model performance</div>
    </div>
    """, unsafe_allow_html=True)

    tab1, tab2, tab3 = st.tabs(["Fraud Patterns", "Model Performance", "Community Analysis"])

    with tab1:
        c1, c2 = st.columns(2)
        with c1:
            # Transaction type breakdown
            type_df = txns_df.groupby(["transaction_type", "is_fraud"]).size().reset_index(name="count")
            fig = px.bar(type_df, x="transaction_type", y="count", color="is_fraud",
                         color_discrete_map={False: "#00d2a0", True: "#ff4b6e"},
                         labels={"is_fraud": "Fraudulent", "count": "Count", "transaction_type": "Type"},
                         title="Transaction Type Breakdown",
                         barmode="group")
            fig.update_layout(paper_bgcolor="#0d1117", plot_bgcolor="#161b22",
                               font=dict(color="#c9d1d9", family="Inter"),
                               xaxis=dict(showgrid=False), yaxis=dict(gridcolor="#21262d"))
            st.plotly_chart(fig, width='stretch')

        with c2:
            # Amount distribution: fraud vs legit
            sample_legit = txns_df[~txns_df["is_fraud"]]["amount"].sample(2000, random_state=42)
            sample_fraud  = txns_df[txns_df["is_fraud"]]["amount"]
            fig2 = go.Figure()
            fig2.add_trace(go.Histogram(x=sample_legit, name="Legitimate",
                                        marker_color="#00d2a066", nbinsx=50))
            fig2.add_trace(go.Histogram(x=sample_fraud, name="Fraudulent",
                                        marker_color="#ff4b6e88", nbinsx=50))
            fig2.update_layout(barmode="overlay", title="Transaction Amount Distribution",
                                paper_bgcolor="#0d1117", plot_bgcolor="#161b22",
                                font=dict(color="#c9d1d9", family="Inter"),
                                xaxis=dict(showgrid=False, title="Amount ($)"),
                                yaxis=dict(gridcolor="#21262d"))
            st.plotly_chart(fig2, width='stretch')

        # Pass-through vs risk scatter
        fig3 = px.scatter(
            scored_df, x="pass_through", y="risk_score",
            color="role", size="total_volume",
            color_discrete_sequence=px.colors.qualitative.Vivid,
            opacity=0.6, title="Pass-Through Ratio vs Risk Score",
            labels={"pass_through": "Pass-Through Ratio", "risk_score": "Risk Score"},
            hover_data=["account_id", "n_sent", "n_recv"],
        )
        fig3.update_layout(paper_bgcolor="#0d1117", plot_bgcolor="#161b22",
                           font=dict(color="#c9d1d9", family="Inter"))
        st.plotly_chart(fig3, width='stretch')

    with tab2:
        c1, c2 = st.columns(2)
        with c1:
            from visualizations import feature_importance_chart
            st.plotly_chart(feature_importance_chart(), width='stretch')
        with c2:
            # XGBoost vs Isolation Forest scatter
            fig4 = px.scatter(
                scored_df, x="xgb_proba", y="iso_score",
                color="is_fraud",
                color_discrete_map={False: "#00d2a066", True: "#ff4b6e"},
                opacity=0.5, title="XGBoost vs Isolation Forest Scores",
                labels={"xgb_proba": "XGBoost Score", "iso_score": "Isolation Forest Score",
                        "is_fraud": "Fraud"},
            )
            fig4.update_layout(paper_bgcolor="#0d1117", plot_bgcolor="#161b22",
                               font=dict(color="#c9d1d9", family="Inter"))
            st.plotly_chart(fig4, width='stretch')

        # Confusion matrix style: TP/FP/TN/FN
        scored_df["pred_fraud"] = scored_df["risk_score"] >= 50
        tp = int(((scored_df["is_fraud"]) & (scored_df["pred_fraud"])).sum())
        fp = int(((~scored_df["is_fraud"]) & (scored_df["pred_fraud"])).sum())
        tn = int(((~scored_df["is_fraud"]) & (~scored_df["pred_fraud"])).sum())
        fn = int(((scored_df["is_fraud"]) & (~scored_df["pred_fraud"])).sum())
        precision = tp / max(tp + fp, 1)
        recall    = tp / max(tp + fn, 1)
        f1        = 2 * precision * recall / max(precision + recall, 1e-9)

        mc1, mc2, mc3, mc4, mc5 = st.columns(5)
        for col, label, val, color in [
            (mc1, "True Positives",  tp, "teal"),
            (mc2, "False Positives", fp, "amber"),
            (mc3, "True Negatives",  tn, "blue"),
            (mc4, "False Negatives", fn, "red"),
            (mc5, "F1 Score",        f"{f1:.3f}", "violet"),
        ]:
            with col:
                metric_card(label, str(val), color=color)

    with tab3:
        suspicious_comms = comms_df[comms_df["is_suspicious"]].sort_values("fraud_density", ascending=False)
        st.markdown(f"**{len(suspicious_comms)} suspicious communities detected**")
        if not suspicious_comms.empty:
            st.dataframe(suspicious_comms, width='stretch', hide_index=True)

        # Community size distribution
        fig5 = px.histogram(comms_df, x="size", nbins=30,
                            color_discrete_sequence=["#58a6ff"],
                            title="Community Size Distribution",
                            labels={"size": "Community Size (nodes)"})
        fig5.update_layout(paper_bgcolor="#0d1117", plot_bgcolor="#161b22",
                           font=dict(color="#c9d1d9", family="Inter"),
                           xaxis=dict(showgrid=False),
                           yaxis=dict(gridcolor="#21262d"))
        st.plotly_chart(fig5, width='stretch')


# ═══════════════════════════════════════════════════════════════════════════════
#  PAGE: EARLY WARNING
# ═══════════════════════════════════════════════════════════════════════════════
def page_early_warning(scored_df, txns_df, idlinks_df):
    st.markdown("""
    <div style='padding:16px 0 8px;'>
        <div style='font-size:24px;font-weight:700;color:#f0f6fc;'>⚠️ Early Warning System</div>
        <div style='color:#8b949e;font-size:13px;'>
            Network Recruitment Risk — identifies accounts likely to be recruited into fraud rings
        </div>
    </div>
    """, unsafe_allow_html=True)

    st.markdown("""
    <div class="alert-card info">
        <strong>ℹ️ About Network Recruitment Risk</strong><br/>
        <span style='font-size:13px;color:#8b949e;'>
        This score estimates the likelihood that a currently "clean" account may be pulled into a fraud ring.
        It is computed from: shared device/IP overlap with known fraud accounts, account age, graph proximity,
        and behavioral similarity. This is a <em>risk indicator</em>, not a calibrated probability.
        </span>
    </div>
    """, unsafe_allow_html=True)

    # Filter to non-confirmed-fraud accounts
    at_risk = scored_df[
        (~scored_df["is_fraud"]) &
        (scored_df["recruitment_risk"] >= 30)
    ].sort_values("recruitment_risk", ascending=False).head(50)

    if at_risk.empty:
        st.info("No high recruitment risk accounts found with current filters.")
        return

    st.markdown(f"**{len(at_risk)} accounts flagged as potential fraud ring recruits**")

    for _, row in at_risk.head(15).iterrows():
        rr = row["recruitment_risk"]
        color = "#ff4b6e" if rr >= 70 else "#f5a623" if rr >= 50 else "#58a6ff"
        st.markdown(f"""
        <div style='background:#161b22;border:1px solid #30363d;border-radius:10px;
                    padding:14px 20px;margin-bottom:8px;
                    display:flex;align-items:center;justify-content:space-between;'>
            <div>
                <span style='font-weight:600;color:#f0f6fc;font-size:15px;'>{row['account_id']}</span>
                <span style='font-size:12px;color:#8b949e;margin-left:12px;'>
                    Age: {int(row.get('age_days',0))}d ·
                    Shared dev: {int(row.get('shared_devices',0))} ·
                    Shared IP: {int(row.get('shared_ips',0))} ·
                    Role: {row.get('role','?')}
                </span>
            </div>
            <div style='text-align:right;'>
                <div style='font-size:11px;color:#8b949e;'>RECRUITMENT RISK</div>
                <div style='font-size:22px;font-weight:700;color:{color};
                            font-family:"JetBrains Mono",monospace;'>{rr:.0f}%</div>
            </div>
        </div>
        """, unsafe_allow_html=True)

    # Trend: new accounts over time
    st.markdown('<div class="section-header">📅 New Account Onboarding Trend</div>',
                unsafe_allow_html=True)
    import plotly.express as px
    accs_with_risk = scored_df.copy()
    # Use account_id index as proxy for creation order
    accs_with_risk["acc_number"] = accs_with_risk["account_id"].str.extract(r"(\d+)").astype(int)
    accs_with_risk["risk_bucket"] = pd.cut(accs_with_risk["recruitment_risk"],
                                            bins=[0,30,60,100], labels=["Low","Medium","High"])

    fig = px.histogram(accs_with_risk, x="acc_number",
                       color="risk_bucket",
                       color_discrete_map={"Low":"#00d2a0","Medium":"#f5a623","High":"#ff4b6e"},
                       nbins=50,
                       title="Account Creation Order vs Recruitment Risk",
                       labels={"acc_number":"Account Number (creation order)",
                               "risk_bucket":"Recruitment Risk"})
    fig.update_layout(paper_bgcolor="#0d1117", plot_bgcolor="#161b22",
                      font=dict(color="#c9d1d9", family="Inter"),
                      xaxis=dict(showgrid=False),
                      yaxis=dict(gridcolor="#21262d"))
    st.plotly_chart(fig, width='stretch')


# ═══════════════════════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════════════════════
def main():
    ensure_data()

    txns_df, accs_df, scored_df, comms_df, cust_df, idlinks_df, stats = load_data()

    page, min_risk, show_fraud_only = render_sidebar(scored_df, comms_df)

    if show_fraud_only:
        scored_df = scored_df[scored_df["is_fraud"]]

    if page == "📊 Overview":
        page_overview(txns_df, accs_df, scored_df, comms_df, stats)
    elif page == "🕸️ Network Explorer":
        page_network(txns_df, scored_df, accs_df, min_risk)
    elif page == "🔍 Account Investigator":
        page_investigator(txns_df, scored_df, accs_df, idlinks_df, cust_df)
    elif page == "🗺️ Geographic Intelligence":
        page_geo(txns_df, scored_df)
    elif page == "📈 Analytics":
        page_analytics(txns_df, scored_df, comms_df, accs_df)
    elif page == "⚠️ Early Warning":
        page_early_warning(scored_df, txns_df, idlinks_df)


if __name__ == "__main__":
    main()
