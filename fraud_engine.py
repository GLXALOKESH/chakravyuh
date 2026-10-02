"""
Feature Engineering + ML Model Training
Builds behavioral, graph, and identity features, then trains XGBoost + Isolation Forest
"""

import pandas as pd
import numpy as np
import networkx as nx
import community as community_louvain
import pickle
import os
import json
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score
import xgboost as xgb
import warnings
warnings.filterwarnings("ignore")


# ─── Load data ────────────────────────────────────────────────────────────────
def load_data(data_path="data"):
    customers_df      = pd.read_csv(f"{data_path}/customers.csv")
    accounts_df       = pd.read_csv(f"{data_path}/accounts.csv")
    identity_links_df = pd.read_csv(f"{data_path}/identity_links.csv")
    txns_df           = pd.read_csv(f"{data_path}/transactions.csv",
                                    parse_dates=["timestamp"])
    return customers_df, accounts_df, identity_links_df, txns_df


# ─── Transaction-based features ───────────────────────────────────────────────
def compute_transaction_features(txns_df, accounts_df):
    """Per-account behavioral statistics from the transaction graph."""
    feats = []
    account_ids = accounts_df["account_id"].tolist()

    # Index for speed
    sent     = txns_df.groupby("source_account")
    received = txns_df.groupby("dest_account")

    for aid in account_ids:
        sent_txns = txns_df[txns_df["source_account"] == aid]
        recv_txns = txns_df[txns_df["dest_account"]   == aid]

        n_sent     = len(sent_txns)
        n_recv     = len(recv_txns)
        amt_sent   = sent_txns["amount"].sum()
        amt_recv   = recv_txns["amount"].sum()
        total_vol  = amt_sent + amt_recv

        # Pass-through ratio
        pass_through = (min(amt_sent, amt_recv) / total_vol) if total_vol > 0 else 0

        # Counterparty diversity
        unique_out = sent_txns["dest_account"].nunique()
        unique_in  = recv_txns["source_account"].nunique()

        # Velocity: transactions per day active
        all_txns = pd.concat([sent_txns, recv_txns])
        if len(all_txns) > 1:
            span_days = max(1, (all_txns["timestamp"].max() - all_txns["timestamp"].min()).days)
            velocity  = len(all_txns) / span_days
        else:
            velocity = 0

        # Burst score: max txns in any 1-hour window
        if len(all_txns) > 0:
            all_txns = all_txns.copy()
            all_txns["hour_bucket"] = all_txns["timestamp"].dt.floor("h")
            burst_score = all_txns.groupby("hour_bucket").size().max()
        else:
            burst_score = 0

        # Time-delay: avg hours between receiving and sending
        avg_delay = 24.0  # default
        if len(recv_txns) > 0 and len(sent_txns) > 0:
            first_recv = recv_txns["timestamp"].min()
            first_sent = sent_txns["timestamp"].min()
            delay_h = (first_sent - first_recv).total_seconds() / 3600
            avg_delay = max(0, delay_h)

        # Large tx ratio (> $5000)
        large_ratio = (len(sent_txns[sent_txns["amount"] > 5000]) / n_sent
                       if n_sent > 0 else 0)

        # Outgoing/incoming ratio
        out_in_ratio = (amt_sent / amt_recv) if amt_recv > 0 else (1 if amt_sent == 0 else 99)

        feats.append({
            "account_id":      aid,
            "n_sent":          n_sent,
            "n_recv":          n_recv,
            "amt_sent":        amt_sent,
            "amt_recv":        amt_recv,
            "total_volume":    total_vol,
            "pass_through":    pass_through,
            "unique_out":      unique_out,
            "unique_in":       unique_in,
            "velocity":        velocity,
            "burst_score":     burst_score,
            "avg_delay_h":     avg_delay,
            "large_tx_ratio":  large_ratio,
            "out_in_ratio":    out_in_ratio,
        })

    return pd.DataFrame(feats)


# ─── Graph / network features ─────────────────────────────────────────────────
def compute_graph_features(txns_df, identity_links_df, accounts_df):
    """Graph centrality + shared-infrastructure features."""
    G = nx.DiGraph()
    for _, row in txns_df.iterrows():
        src, dst, amt = row["source_account"], row["dest_account"], row["amount"]
        if G.has_edge(src, dst):
            G[src][dst]["weight"] += amt
            G[src][dst]["count"]  += 1
        else:
            G.add_edge(src, dst, weight=amt, count=1)

    # Degree centrality
    in_deg  = dict(G.in_degree(weight="weight"))
    out_deg = dict(G.out_degree(weight="weight"))
    pr      = nx.pagerank(G, weight="weight", max_iter=200)

    # Betweenness on largest SCC (too slow for full graph, use approx)
    try:
        bet = nx.betweenness_centrality(G, k=min(100, len(G)), normalized=True)
    except Exception:
        bet = {n: 0 for n in G.nodes()}

    # Identity sharing counts
    dev_sharing = (identity_links_df[identity_links_df["entity_type"] == "device"]
                   .groupby("entity_id")["account_id"].count())
    ip_sharing  = (identity_links_df[identity_links_df["entity_type"] == "ip"]
                   .groupby("entity_id")["account_id"].count())

    acc_dev = identity_links_df[identity_links_df["entity_type"] == "device"].copy()
    acc_ip  = identity_links_df[identity_links_df["entity_type"] == "ip"].copy()

    # Per account: how many OTHER accounts share a device/IP with it
    def shared_count(acc_id, links_df, sharing_series):
        entities = links_df[links_df["account_id"] == acc_id]["entity_id"].tolist()
        total = 0
        for eid in entities:
            if eid in sharing_series.index:
                total += sharing_series[eid] - 1  # exclude self
        return total

    feats = []
    for aid in accounts_df["account_id"].tolist():
        feats.append({
            "account_id":       aid,
            "in_degree_w":      in_deg.get(aid, 0),
            "out_degree_w":     out_deg.get(aid, 0),
            "pagerank":         pr.get(aid, 0),
            "betweenness":      bet.get(aid, 0),
            "shared_devices":   shared_count(aid, acc_dev, dev_sharing),
            "shared_ips":       shared_count(aid, acc_ip, ip_sharing),
        })

    return pd.DataFrame(feats), G


# ─── Community / network detection ────────────────────────────────────────────
def detect_fraud_networks(G, accounts_df, txns_df):
    """Use Louvain community detection + heuristics to label suspicious clusters."""
    # Work on undirected for community detection
    UG = G.to_undirected()

    # Only keep largest connected components
    partition = community_louvain.best_partition(UG, weight="weight", random_state=42)

    community_stats = {}
    for node, comm_id in partition.items():
        community_stats.setdefault(comm_id, {"nodes": [], "fraud_nodes": 0})
        community_stats[comm_id]["nodes"].append(node)

    # Mark communities with high fraud density
    fraud_accounts = set(accounts_df[accounts_df["is_fraud"]]["account_id"])
    for comm_id, info in community_stats.items():
        nodes     = info["nodes"]
        fraud_cnt = sum(1 for n in nodes if n in fraud_accounts)
        # Volume through community
        comm_txns = txns_df[
            txns_df["source_account"].isin(nodes) &
            txns_df["dest_account"].isin(nodes)
        ]
        info["size"]            = len(nodes)
        info["fraud_nodes"]     = fraud_cnt
        info["fraud_density"]   = fraud_cnt / max(len(nodes), 1)
        info["internal_volume"] = comm_txns["amount"].sum()
        info["internal_txns"]   = len(comm_txns)
        info["is_suspicious"]   = (fraud_density := fraud_cnt / max(len(nodes), 1)) > 0.3

    return partition, community_stats


# ─── Role detection ───────────────────────────────────────────────────────────
def classify_roles(txn_feats_df):
    """Rule-based role classification for accounts."""
    roles = []
    for _, row in txn_feats_df.iterrows():
        pt   = row["pass_through"]
        sent = row["amt_sent"]
        recv = row["amt_recv"]
        n_s  = row["n_sent"]
        n_r  = row["n_recv"]

        if n_r == 0 and n_s > 0:
            role = "Source"
        elif n_s == 0 and n_r > 0:
            role = "Cash-out"
        elif pt > 0.85:
            role = "Relay"
        elif pt > 0.5 and row["unique_out"] > 5:
            role = "Mule"
        elif row["unique_out"] > 10 and sent > recv:
            role = "Coordinator"
        else:
            role = "Normal"

        roles.append({"account_id": row["account_id"], "role": role})
    return pd.DataFrame(roles)


# ─── Risk scoring ─────────────────────────────────────────────────────────────
FEATURE_COLS = [
    "n_sent", "n_recv", "amt_sent", "amt_recv", "total_volume",
    "pass_through", "unique_out", "unique_in", "velocity", "burst_score",
    "avg_delay_h", "large_tx_ratio", "out_in_ratio",
    "in_degree_w", "out_degree_w", "pagerank", "betweenness",
    "shared_devices", "shared_ips", "age_days",
]

def build_features(accounts_df, txn_feats_df, graph_feats_df):
    merged = accounts_df[["account_id", "age_days", "is_fraud"]].merge(
        txn_feats_df, on="account_id"
    ).merge(graph_feats_df, on="account_id")
    return merged


def train_models(merged_df, models_path="models"):
    os.makedirs(models_path, exist_ok=True)

    X = merged_df[FEATURE_COLS].fillna(0).replace([np.inf, -np.inf], 0)
    y = merged_df["is_fraud"].astype(int)

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # ── Isolation Forest (unsupervised) ──────────────────────────────────────
    iso = IsolationForest(n_estimators=200, contamination=0.05, random_state=42)
    iso.fit(X_scaled)
    iso_scores = -iso.score_samples(X_scaled)   # higher = more anomalous
    iso_norm   = (iso_scores - iso_scores.min()) / (iso_scores.max() - iso_scores.min() + 1e-9)

    # ── XGBoost (supervised) ─────────────────────────────────────────────────
    X_tr, X_te, y_tr, y_te = train_test_split(
        X_scaled, y, test_size=0.2, stratify=y, random_state=42
    )
    scale_pos = max(1, (y == 0).sum() / max((y == 1).sum(), 1))
    xgb_model = xgb.XGBClassifier(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.05,
        scale_pos_weight=scale_pos,
        use_label_encoder=False,
        eval_metric="logloss",
        random_state=42,
        verbosity=0,
    )
    xgb_model.fit(X_tr, y_tr,
                  eval_set=[(X_te, y_te)],
                  verbose=False)

    xgb_proba = xgb_model.predict_proba(X_scaled)[:, 1]

    try:
        auc = roc_auc_score(y, xgb_proba)
        print(f"   XGBoost AUC: {auc:.4f}")
    except Exception:
        pass

    # ── Composite risk score 0–100 ────────────────────────────────────────────
    risk_score = (0.6 * xgb_proba + 0.4 * iso_norm) * 100
    risk_score = np.clip(risk_score, 0, 100)

    # Save artefacts
    with open(f"{models_path}/scaler.pkl", "wb") as f:
        pickle.dump(scaler, f)
    with open(f"{models_path}/iso_forest.pkl", "wb") as f:
        pickle.dump(iso, f)
    with open(f"{models_path}/xgb_model.pkl", "wb") as f:
        pickle.dump(xgb_model, f)

    # Feature importances
    fi = dict(zip(FEATURE_COLS, xgb_model.feature_importances_.tolist()))
    with open(f"{models_path}/feature_importances.json", "w") as f:
        json.dump(fi, f, indent=2)

    return risk_score, xgb_proba, iso_norm, xgb_model, scaler


# ─── Explainability ───────────────────────────────────────────────────────────
def generate_explanations(row, shared_dev, shared_ip):
    """Return a list of plain-language explanation strings for a flagged account."""
    reasons = []

    if shared_dev > 0:
        reasons.append(f"🔗 Shared device with {shared_dev} other account(s)")
    if shared_ip > 0:
        reasons.append(f"🌐 Shared IP address with {shared_ip} other account(s)")
    if row.get("pass_through", 0) > 0.8:
        reasons.append(f"↔️ High pass-through ratio ({row['pass_through']:.0%}) — funds in = funds out")
    if row.get("velocity", 0) > 20:
        reasons.append(f"⚡ High transaction velocity ({row['velocity']:.1f} txns/day)")
    if row.get("burst_score", 0) > 10:
        reasons.append(f"💥 Burst activity: {int(row['burst_score'])} transactions in one hour")
    if row.get("age_days", 999) < 60:
        reasons.append(f"🆕 Newly created account ({int(row['age_days'])} days old)")
    if row.get("avg_delay_h", 99) < 2:
        reasons.append(f"⏱️ Very short delay between receiving and sending funds ({row['avg_delay_h']:.1f}h)")
    if row.get("large_tx_ratio", 0) > 0.5:
        reasons.append(f"💰 {row['large_tx_ratio']:.0%} of sent transactions exceed $5,000")
    if row.get("pagerank", 0) > 0.005:
        reasons.append(f"📈 High PageRank centrality — hub node in transaction network")
    if row.get("betweenness", 0) > 0.01:
        reasons.append(f"🕸️ High betweenness centrality — bridges multiple clusters")
    if not reasons:
        reasons.append("📊 Anomaly detected by statistical model (behavioral deviation)")

    return reasons


# ─── Recruitment risk ─────────────────────────────────────────────────────────
def compute_recruitment_risk(accounts_df, identity_links_df, graph_feats_df, risk_scores):
    """
    For each account, compute probability it might be recruited into a fraud ring.
    Uses shared infrastructure proximity and graph adjacency to known-fraud nodes.
    """
    fraud_set = set(accounts_df[accounts_df["is_fraud"]]["account_id"])

    # Device/IP overlap with fraud accounts
    dev_links = identity_links_df[identity_links_df["entity_type"] == "device"]
    ip_links  = identity_links_df[identity_links_df["entity_type"] == "ip"]

    fraud_devices = set(dev_links[dev_links["account_id"].isin(fraud_set)]["entity_id"])
    fraud_ips     = set(ip_links[ip_links["account_id"].isin(fraud_set)]["entity_id"])

    recruitment = []
    for _, row in accounts_df.iterrows():
        aid = row["account_id"]
        if aid in fraud_set:
            recruitment.append({"account_id": aid, "recruitment_risk": 100.0})
            continue

        score = 0
        # Shared device with fraud account
        my_devs = set(dev_links[dev_links["account_id"] == aid]["entity_id"])
        overlap_dev = len(my_devs & fraud_devices)
        score += min(40, overlap_dev * 20)

        # Shared IP with fraud account
        my_ips = set(ip_links[ip_links["account_id"] == aid]["entity_id"])
        overlap_ip = len(my_ips & fraud_ips)
        score += min(30, overlap_ip * 15)

        # Account age
        age = row.get("age_days", 365)
        if age < 30:
            score += 20
        elif age < 90:
            score += 10

        # Own risk score
        own_risk = risk_scores.get(aid, 0)
        score += own_risk * 0.1

        recruitment.append({
            "account_id":       aid,
            "recruitment_risk": min(100, round(score, 1)),
        })

    return pd.DataFrame(recruitment)


# ─── Main pipeline ────────────────────────────────────────────────────────────
def run_pipeline(data_path="data", models_path="models", output_path="data"):
    print("Loading data...")
    customers_df, accounts_df, identity_links_df, txns_df = load_data(data_path)

    print("Computing transaction features...")
    txn_feats_df = compute_transaction_features(txns_df, accounts_df)

    print("Computing graph features...")
    graph_feats_df, G = compute_graph_features(txns_df, identity_links_df, accounts_df)

    print("Detecting communities...")
    partition, community_stats = detect_fraud_networks(G, accounts_df, txns_df)

    print("Classifying roles...")
    roles_df = classify_roles(txn_feats_df)

    print("Building merged features...")
    merged_df = build_features(accounts_df, txn_feats_df, graph_feats_df)

    print("Training models...")
    risk_scores_arr, xgb_proba, iso_norm, xgb_model, scaler = train_models(merged_df, models_path)

    # Attach risk scores
    merged_df["risk_score"]  = risk_scores_arr.round(1)
    merged_df["xgb_proba"]   = (xgb_proba * 100).round(1)
    merged_df["iso_score"]   = (iso_norm  * 100).round(1)

    # Community assignment
    merged_df["community_id"] = merged_df["account_id"].map(partition)

    # Role assignment
    merged_df = merged_df.merge(roles_df, on="account_id", how="left")

    # Explanations
    risk_score_dict = dict(zip(merged_df["account_id"], merged_df["risk_score"]))
    expl_rows = []
    for _, row in merged_df.iterrows():
        sd = row.get("shared_devices", 0)
        si = row.get("shared_ips", 0)
        reasons = generate_explanations(row.to_dict(), sd, si)
        expl_rows.append({
            "account_id":   row["account_id"],
            "explanations": " | ".join(reasons),
        })
    expl_df = pd.DataFrame(expl_rows)
    merged_df = merged_df.merge(expl_df, on="account_id", how="left")

    # Recruitment risk
    print("Computing recruitment risk...")
    recruit_df = compute_recruitment_risk(accounts_df, identity_links_df,
                                          graph_feats_df, risk_score_dict)
    merged_df = merged_df.merge(recruit_df, on="account_id", how="left")

    # Ring ID from accounts
    ring_info = accounts_df[["account_id", "fraud_type", "ring_id"]].copy()
    if "fraud_type" in merged_df.columns:
        merged_df = merged_df.drop(columns=["fraud_type"], errors="ignore")
    merged_df = merged_df.merge(ring_info, on="account_id", how="left")

    # Save
    merged_df.to_csv(f"{output_path}/account_scores.csv", index=False)

    # Community stats
    comm_rows = []
    for cid, info in community_stats.items():
        comm_rows.append({
            "community_id":    cid,
            "size":            info["size"],
            "fraud_nodes":     info["fraud_nodes"],
            "fraud_density":   round(info.get("fraud_density", 0), 3),
            "internal_volume": round(info.get("internal_volume", 0), 2),
            "internal_txns":   info.get("internal_txns", 0),
            "is_suspicious":   info.get("is_suspicious", False),
        })
    comm_df = pd.DataFrame(comm_rows).sort_values("fraud_density", ascending=False)
    comm_df.to_csv(f"{output_path}/communities.csv", index=False)

    print("\n[DONE] Pipeline complete.")
    print(f"   Suspicious accounts (risk > 70): {(merged_df['risk_score'] > 70).sum()}")
    print(f"   Suspicious communities: {comm_df['is_suspicious'].sum()}")


    return merged_df, comm_df, G, partition


if __name__ == "__main__":
    run_pipeline()
