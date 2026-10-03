"""
models.py  —  Chakravyuh ML Models
====================================
Implements:
  - V1: XGBoost (transaction/behavioural features only)
  - V2: XGBoost (V1 features + identity features)
  - Isolation Forest anomaly signal
  - Risk score normalisation to 0–100
  - Recruitment risk scoring (rule-based)
  - SHAP-based "Why Flagged" explanations

All models use ONLY synthetic data. No real banking data.

Public API:
    train_models(train_df, train_labels)   -> (v1_model, v2_model, iso_model)
    score_accounts(df, v1, v2, iso)        -> DataFrame with risk_v1, risk_v2, risk_combined columns
    get_signals(account_id, df, v2_model)  -> list of signal dicts
    compute_recruitment_risk(candidates, ring_members, identifiers, df) -> list of recruit dicts
    evaluate(df, labels, v1, v2)           -> dict with pr_auc, ring_recall, etc.
"""

import json
import pickle
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.metrics import average_precision_score
from sklearn.preprocessing import MinMaxScaler

warnings.filterwarnings("ignore")

try:
    import xgboost as xgb
    XGB_AVAILABLE = True
except ImportError:
    XGB_AVAILABLE = False
    print("⚠  XGBoost not installed. Install with: pip install xgboost")

try:
    import shap
    SHAP_AVAILABLE = True
except ImportError:
    SHAP_AVAILABLE = False

try:
    from ml.features import (V1_FEATURES, V2_EXTRA_FEATURES, V2_GEO_FEATURES,
                           explain_signals, v2_features)
except ImportError:
    from features import (V1_FEATURES, V2_EXTRA_FEATURES, V2_GEO_FEATURES,
                           explain_signals, v2_features)

# ─────────────────────────────────────────────────────────────────
# 1.  XGBOOST CONFIGURATION
# ─────────────────────────────────────────────────────────────────

XGB_PARAMS = dict(
    n_estimators=200,
    max_depth=4,
    learning_rate=0.1,
    eval_metric="aucpr",
    use_label_encoder=False,
    random_state=42,
    n_jobs=-1,
)


def _make_xgb(neg, pos):
    """Return an XGBClassifier with scale_pos_weight set from class counts."""
    if not XGB_AVAILABLE:
        raise RuntimeError("XGBoost is not installed.")
    scale = max(1, neg // max(pos, 1))
    params = dict(XGB_PARAMS)
    params["scale_pos_weight"] = scale
    return xgb.XGBClassifier(**params)


# ─────────────────────────────────────────────────────────────────
# 2.  TRAINING
# ─────────────────────────────────────────────────────────────────

def train_models(train_df: pd.DataFrame, train_labels: pd.Series,
                 geo: bool = False) -> tuple:
    """
    Train V1 and V2 XGBoost models + Isolation Forest.

    Parameters:
        train_df      DataFrame from features.compute_features()
        train_labels  Series[bool]  index=account_id, True=fraud ring member
        geo           include geo features in V2

    Returns (v1_model, v2_model, iso_model, scaler)
    """
    print("\n  [models] Training V1 (transaction features)...")

    v1_cols = [c for c in V1_FEATURES if c in train_df.columns]
    v2_cols = v2_features(geo)
    v2_cols = [c for c in v2_cols if c in train_df.columns]

    # Align labels to df index
    y = train_labels.reindex(train_df.index).fillna(False).astype(int)
    neg = int((y == 0).sum())
    pos = int((y == 1).sum())
    print(f"     Labels: {pos} fraud / {neg} normal  "
          f"(scale_pos_weight={max(1, neg//max(pos,1))})")

    X_v1 = train_df[v1_cols].fillna(0)
    X_v2 = train_df[v2_cols].fillna(0)

    v1_model = _make_xgb(neg, pos)
    v1_model.fit(X_v1, y, verbose=False)
    print("     V1 trained.")

    print("  [models] Training V2 (V1 + identity features)...")
    v2_model = _make_xgb(neg, pos)
    v2_model.fit(X_v2, y, verbose=False)
    print("     V2 trained.")

    print("  [models] Training Isolation Forest...")
    iso_model = IsolationForest(
        n_estimators=200,
        contamination=0.05,
        random_state=42,
        n_jobs=-1,
    )
    iso_model.fit(X_v1)
    print("     Isolation Forest trained.")

    # Scaler for combined risk normalisation
    scaler = MinMaxScaler()
    scaler.fit(X_v1)

    return v1_model, v2_model, iso_model, scaler


# ─────────────────────────────────────────────────────────────────
# 3.  SCORING
# ─────────────────────────────────────────────────────────────────

def _normalise_to_100(probs: np.ndarray) -> np.ndarray:
    """Map [0,1] probability array to integer risk score [0,100]."""
    clipped = np.clip(probs, 0.0, 1.0)
    return np.round(clipped * 100).astype(int)


def score_accounts(df: pd.DataFrame, v1_model, v2_model, iso_model,
                   geo: bool = False) -> pd.DataFrame:
    """
    Score all accounts.

    Returns DataFrame with columns:
        risk_v1         int 0–100   (V1 XGBoost)
        risk_v2         int 0–100   (V2 XGBoost)
        anomaly_score   float       (Isolation Forest, higher = more anomalous)
        risk_combined   int 0–100   (weighted combination)
    """
    v1_cols = [c for c in V1_FEATURES if c in df.columns]
    v2_cols = [c for c in v2_features(geo) if c in df.columns]

    X_v1 = df[v1_cols].fillna(0)
    X_v2 = df[v2_cols].fillna(0)

    prob_v1 = v1_model.predict_proba(X_v1)[:, 1]
    prob_v2 = v2_model.predict_proba(X_v2)[:, 1]

    # Isolation Forest: score is negative  (more negative = more anomalous)
    # Map to 0–1: 1 = most anomalous
    iso_raw = iso_model.decision_function(X_v1)
    iso_norm = 1.0 - (iso_raw - iso_raw.min()) / max(iso_raw.max() - iso_raw.min(), 1e-9)

    # Combined: 60% V2 + 30% V1 + 10% anomaly
    combined = 0.60 * prob_v2 + 0.30 * prob_v1 + 0.10 * iso_norm
    combined = np.clip(combined, 0.0, 1.0)

    result = df.copy()
    result["risk_v1"]       = np.round(prob_v1, 4)
    result["risk_v2"]       = np.round(prob_v2, 4)
    result["anomaly_score"] = np.round(iso_norm, 4)
    result["risk_combined"] = np.round(combined, 4)
    result["prob_v1"]       = np.round(prob_v1, 6)
    result["prob_v2"]       = np.round(prob_v2, 6)

    return result


# ─────────────────────────────────────────────────────────────────
# 4.  SHAP / "WHY FLAGGED"
# ─────────────────────────────────────────────────────────────────

def get_signals(account_id: str, df: pd.DataFrame, v2_model,
                geo: bool = False) -> list:
    """
    Return top-3 positive SHAP contributions for a single account.
    Falls back to feature importance if SHAP is not available.

    Returns list of {"feature", "label", "weight"} dicts.
    """
    v2_cols = [c for c in v2_features(geo) if c in df.columns]
    if account_id not in df.index:
        return []

    row = df.loc[[account_id]][v2_cols].fillna(0)

    contributions = []

    if SHAP_AVAILABLE:
        try:
            explainer    = shap.TreeExplainer(v2_model)
            shap_values  = explainer.shap_values(row)
            # shap_values shape: (1, n_features)  or list for multi-class
            if isinstance(shap_values, list):
                sv = shap_values[1][0]   # class=1
            else:
                sv = shap_values[0]
            for feat, sv_val in zip(v2_cols, sv):
                feat_val = float(row[feat].iloc[0])
                contributions.append((feat, float(sv_val), feat_val))
        except Exception:
            SHAP_AVAILABLE_LOCAL = False
    else:
        SHAP_AVAILABLE_LOCAL = False

    # Fallback: use gain-based importance
    if not contributions:
        importances = v2_model.get_booster().get_score(importance_type="gain")
        for feat in v2_cols:
            if feat in importances and feat in df.columns:
                feat_val = float(df.at[account_id, feat])
                # Estimate contribution = importance * normalised feature value
                imp = importances.get(feat, 0.0)
                contributions.append((feat, imp / max(sum(importances.values()), 1), feat_val))

    return explain_signals(contributions)


# ─────────────────────────────────────────────────────────────────
# 5.  EVALUATION
# ─────────────────────────────────────────────────────────────────

def evaluate(scored_df: pd.DataFrame, ground_truth: list,
             v1_model=None, v2_model=None) -> dict:
    """
    Compute PR-AUC for V1 and V2, ring recall, and pattern-D recall.

    ground_truth: list of ring dicts from ground_truth.json.
    scored_df must have columns: prob_v1, prob_v2.
    """
    all_fraud_ids   = set()
    pattern_d_ids   = set()
    detected_rings  = {}   # ring_id -> set of member_ids in scored_df

    for ring in ground_truth:
        members = set(ring["member_ids"])
        all_fraud_ids.update(members)
        if ring.get("pattern") == "D":
            pattern_d_ids.update(members)

    # Build label arrays
    idx   = scored_df.index
    y_true = pd.Series(
        [1 if i in all_fraud_ids else 0 for i in idx],
        index=idx
    )

    pr_auc_v1 = pr_auc_v2 = 0.0
    if "prob_v1" in scored_df.columns and y_true.sum() > 0:
        pr_auc_v1 = average_precision_score(y_true, scored_df["prob_v1"].fillna(0))
    if "prob_v2" in scored_df.columns and y_true.sum() > 0:
        pr_auc_v2 = average_precision_score(y_true, scored_df["prob_v2"].fillna(0))

    # Ring recall: fraction of fraud members with risk_v2 >= threshold
    max_val = scored_df["risk_v2"].max() if "risk_v2" in scored_df.columns and len(scored_df) > 0 else 1.0
    threshold = 0.50 if max_val <= 1.0 else 50
    flagged   = set(scored_df[scored_df["risk_v2"] >= threshold].index)
    fraud_in_df  = all_fraud_ids & set(idx)
    ring_recall  = len(fraud_in_df & flagged) / max(len(fraud_in_df), 1)

    # Pattern D recall
    d_in_df = pattern_d_ids & set(idx)
    d_recall = len(d_in_df & flagged) / max(len(d_in_df), 1)

    return {
        "pr_auc_v1":         round(pr_auc_v1, 4),
        "pr_auc_v2":         round(pr_auc_v2, 4),
        "ring_recall":       round(ring_recall, 4),
        "pattern_d_recall":  round(d_recall, 4),
        "n_fraud_accounts":  len(fraud_in_df),
        "n_flagged":         len(flagged),
        "note":              "Synthetic data — rings planted by the team",
    }


# ─────────────────────────────────────────────────────────────────
# 6.  RECRUITMENT RISK
# ─────────────────────────────────────────────────────────────────

def compute_recruitment_risk(accounts: list, ring_member_ids: set,
                              identifiers: list, scored_df: pd.DataFrame,
                              ring_id: str = None,
                              max_hops: int = 2) -> list:
    """
    Identify accounts OUTSIDE the ring that are at risk of being recruited.

    Scoring signals (all explainable):
        +30  shares any identifier with a ring member
        +20  account is < 14 days old
        +15  shares phone with ring member
        +10  shares device with ring member
        +10  neighbours' mean risk_v2 >= 50
        +10  account age_days <= 3 (very new)
         +5  no transactions yet (txn_in + txn_out == 0)

    Normalise to 0–100 after summing.
    Returns list of {id, score, reasons} sorted descending by score.
    """
    from collections import defaultdict
    from datetime import datetime, timezone

    # Build: identifier_id -> member_ids  (for ring members only)
    ring_identifier_map = defaultdict(set)   # identifier_id -> ring members sharing it
    for rec in identifiers:
        ring_overlap = set(rec["account_ids"]) & ring_member_ids
        if ring_overlap:
            ring_identifier_map[rec["_id"]].update(ring_overlap)

    # Build: account_id -> identifier records
    acc_id_map = defaultdict(list)
    for rec in identifiers:
        for a in rec["account_ids"]:
            acc_id_map[a].append(rec)

    # Candidates: accounts NOT in ring
    candidate_ids = {a["_id"] for a in accounts} - ring_member_ids
    # Exclude SALARY, CASH, VICTIM accounts
    candidate_ids = {a for a in candidate_ids
                     if not a.startswith("VICTIM") and a not in ("SALARY", "CASH")}

    results = []

    for acc in accounts:
        aid = acc["_id"]
        if aid not in candidate_ids:
            continue

        score   = 0
        reasons = []

        # Check shared identifiers with ring members
        shared_with_ring = defaultdict(set)   # type -> ring members
        for rec in acc_id_map.get(aid, []):
            ring_overlap = ring_identifier_map.get(rec["_id"], set())
            if ring_overlap:
                shared_with_ring[rec["type"]].update(ring_overlap)

        if shared_with_ring.get("device"):
            member = next(iter(shared_with_ring["device"]))
            score += 25
            reasons.append(f"Shares device with ring member {member}")

        if shared_with_ring.get("phone"):
            member = next(iter(shared_with_ring["phone"]))
            score += 20
            reasons.append(f"Shares phone number with ring member {member}")

        if shared_with_ring.get("ip"):
            score += 10
            reasons.append("Shares IP address with a ring member")

        if not shared_with_ring:
            continue   # skip accounts with no ring connection

        # Account age
        try:
            opened_dt = datetime.strptime(acc["opened_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            now_dt    = datetime.now(timezone.utc)
            age_days  = (now_dt - opened_dt).total_seconds() / 86400
        except Exception:
            age_days = 9999

        if age_days <= 3:
            score += 20
            reasons.append(f"Account is only {age_days:.0f} days old")
        elif age_days <= 14:
            score += 10
            reasons.append(f"Account is {age_days:.0f} days old (recently opened)")

        # No transactions
        if aid in scored_df.index:
            row = scored_df.loc[aid]
            txn_total = row.get("txn_in", 0) + row.get("txn_out", 0)
            if txn_total == 0:
                score += 10
                reasons.append("No transactions yet — account is inactive")

            # Neighbour risk
            nb_risk = row.get("neighbour_risk_v1", 0.0)
            if nb_risk >= 0.5:
                score += 10
                reasons.append(f"Connected to high-risk accounts (mean risk {nb_risk:.2f})")
        else:
            score += 5
            reasons.append("Account not yet active in dataset")

        # Normalise score to 0–100 (max raw score ≈ 90)
        norm_score = min(int(score * 100 / 90), 100)

        if norm_score >= 30:   # only flag meaningful candidates
            results.append({
                "id":          aid,
                "score":       norm_score,
                "ring_id":     ring_id,
                "reasons":     reasons[:5],
                "age_days":    round(age_days, 1) if age_days < 9999 else None,
            })

    results.sort(key=lambda x: -x["score"])
    return results


# ─────────────────────────────────────────────────────────────────
# 7.  MODEL PERSISTENCE
# ─────────────────────────────────────────────────────────────────

def save_models(v1, v2, iso, scaler, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_dir / "v1_model.pkl", "wb") as f:
        pickle.dump(v1, f)
    with open(out_dir / "v2_model.pkl", "wb") as f:
        pickle.dump(v2, f)
    with open(out_dir / "iso_model.pkl", "wb") as f:
        pickle.dump(iso, f)
    with open(out_dir / "scaler.pkl", "wb") as f:
        pickle.dump(scaler, f)
    print(f"  [models] Saved to {out_dir}")


def load_models(model_dir: Path) -> tuple:
    with open(model_dir / "v1_model.pkl", "rb") as f:
        v1 = pickle.load(f)
    with open(model_dir / "v2_model.pkl", "rb") as f:
        v2 = pickle.load(f)
    with open(model_dir / "iso_model.pkl", "rb") as f:
        iso = pickle.load(f)
    with open(model_dir / "scaler.pkl", "rb") as f:
        scaler = pickle.load(f)
    return v1, v2, iso, scaler
