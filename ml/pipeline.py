"""
pipeline.py  —  Chakravyuh End-to-End ML Pipeline
=====================================================
Orchestrates the full pipeline from data loading through to JSON export.

Pipeline order (TRD §7.1):
    generate → features → models (V1/V2) → rings → taint → freeze → recruits → outputs/

Usage:
    python pipeline.py --profile demo
    python pipeline.py --profile demo --geo

Must finish in < 60 seconds on the demo profile.
"""

import argparse
import json
import sys
import time
from pathlib import Path

# Ensure ml/ is on the path
ML_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ML_DIR))

import pandas as pd

from config import GLOBAL_SEED, DATA_DIR, SAVED_MODELS_DIR, RISK_BAND_THRESHOLDS
from features import compute_features, V1_FEATURES, v2_features
from models import (train_models, score_accounts, evaluate, get_signals,
                    save_models, load_models, compute_recruitment_risk)
from rings import discover_rings, classify_roles
from taint import compute_default_taint
from freeze import compute_default_freeze


# ─────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────

def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(data, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)


def risk_band(prob):
    """Map a 0-1 probability to a risk band string."""
    if prob >= RISK_BAND_THRESHOLDS["CRITICAL"]:
        return "CRITICAL"
    elif prob >= RISK_BAND_THRESHOLDS["HIGH"]:
        return "HIGH"
    elif prob >= RISK_BAND_THRESHOLDS["MEDIUM"]:
        return "MEDIUM"
    return "LOW"


# ─────────────────────────────────────────────────────────────────
# PIPELINE
# ─────────────────────────────────────────────────────────────────

def run_pipeline(profile: str, geo: bool = False, train_profile: str = "train",
                 test_profile: str = "test"):
    """
    Run the full pipeline for a profile.

    Steps:
        1. Load data (profile + train + test)
        2. Compute features (train set)
        3. Train V1/V2 models
        4. Compute features (target profile — possibly with V1 neighbour risk)
        5. Score accounts
        6. Evaluate on test set
        7. Discover rings
        8. Classify roles
        9. Compute default taint per ring
        10. Compute default freeze per ring
        11. Compute recruitment risk
        12. Build output JSON files
    """
    t0 = time.time()
    print(f"\n{'='*60}")
    print(f"  PIPELINE: {profile.upper()}")
    print(f"{'='*60}")

    # ── 1. LOAD DATA ──────────────────────────────────────────

    data_root = ML_DIR / "data"
    profile_dir = data_root / profile

    if not profile_dir.exists():
        print(f"  ERROR: {profile_dir} does not exist. Run generate.py first.")
        sys.exit(1)

    print(f"\n  [1/12] Loading {profile} data...")
    accounts     = load_json(profile_dir / "accounts.json")
    transactions = load_json(profile_dir / "transactions.json")
    identifiers  = load_json(profile_dir / "identifiers.json")
    ground_truth = load_json(profile_dir / "ground_truth.json")

    print(f"         {len(accounts)} accounts, {len(transactions)} transactions, "
          f"{len(identifiers)} identifiers, {len(ground_truth)} rings")

    # Load train data (for model training)
    train_dir = data_root / train_profile
    if train_dir.exists() and train_profile != profile:
        print(f"  [1/12] Loading {train_profile} data for training...")
        train_accounts     = load_json(train_dir / "accounts.json")
        train_transactions = load_json(train_dir / "transactions.json")
        train_identifiers  = load_json(train_dir / "identifiers.json")
        train_gt           = load_json(train_dir / "ground_truth.json")
    else:
        print(f"  [1/12] Using {profile} data for training (no separate train set).")
        train_accounts     = accounts
        train_transactions = transactions
        train_identifiers  = identifiers
        train_gt           = ground_truth

    # ── 2. COMPUTE FEATURES (TRAIN) ──────────────────────────

    print(f"\n  [2/12] Computing features on training data...")
    train_df = compute_features(train_accounts, train_transactions, train_identifiers, geo=geo)

    # Build training labels
    train_fraud_ids = set()
    for ring in train_gt:
        train_fraud_ids.update(ring["member_ids"])
    train_labels = pd.Series(
        {aid: aid in train_fraud_ids for aid in train_df.index}
    )

    # ── 3. TRAIN MODELS ──────────────────────────────────────

    print(f"\n  [3/12] Training models...")
    v1_model, v2_model, iso_model, scaler = train_models(train_df, train_labels, geo=geo)

    # Save models
    save_models(v1_model, v2_model, iso_model, scaler, SAVED_MODELS_DIR)

    # ── 4. COMPUTE FEATURES (TARGET PROFILE) ─────────────────

    if profile != train_profile:
        print(f"\n  [4/12] Computing features on {profile} data...")
        # First pass without neighbour risk
        target_df = compute_features(accounts, transactions, identifiers, geo=geo)

        # Score V1 to get neighbour risk
        v1_risk_map = {}
        scored_v1 = score_accounts(target_df, v1_model, v2_model, iso_model, geo=geo)
        for aid in scored_v1.index:
            v1_risk_map[aid] = float(scored_v1.at[aid, "prob_v1"])

        # Recompute with neighbour risk
        target_df = compute_features(accounts, transactions, identifiers,
                                     risk_v1_map=v1_risk_map, geo=geo)
    else:
        target_df = train_df

    # ── 5. SCORE ACCOUNTS ────────────────────────────────────

    print(f"\n  [5/12] Scoring accounts...")
    scored_df = score_accounts(target_df, v1_model, v2_model, iso_model, geo=geo)

    # ── 6. EVALUATE ON TEST SET ──────────────────────────────

    test_dir = data_root / test_profile
    metrics = {}
    if test_dir.exists() and test_profile != profile:
        print(f"\n  [6/12] Evaluating on {test_profile} set...")
        test_accounts     = load_json(test_dir / "accounts.json")
        test_transactions = load_json(test_dir / "transactions.json")
        test_identifiers  = load_json(test_dir / "identifiers.json")
        test_gt           = load_json(test_dir / "ground_truth.json")

        test_df = compute_features(test_accounts, test_transactions, test_identifiers, geo=geo)
        test_scored = score_accounts(test_df, v1_model, v2_model, iso_model, geo=geo)
        metrics = evaluate(test_scored, test_gt)
        print(f"         Metrics: {json.dumps(metrics, indent=2)}")
    else:
        print(f"\n  [6/12] Evaluating on {profile} set (no separate test set)...")
        metrics = evaluate(scored_df, ground_truth)
        print(f"         Metrics: {json.dumps(metrics, indent=2)}")

    # ── 7. DISCOVER RINGS ────────────────────────────────────

    print(f"\n  [7/12] Discovering rings...")
    rings = discover_rings(accounts, transactions, identifiers, scored_df)

    if not rings:
        print("  WARNING: No rings discovered. Trying lower thresholds...")
        rings = discover_rings(accounts, transactions, identifiers, scored_df,
                               risk_threshold=0.3, min_mean_risk=0.4)

    # ── 8. CLASSIFY ROLES ────────────────────────────────────

    print(f"\n  [8/12] Classifying roles...")
    for ring in rings:
        role_map = classify_roles(ring, transactions, identifiers, scored_df)
        ring["roles"] = role_map

        # Update account records with ring and role info
        for acc in accounts:
            if acc["_id"] in role_map:
                acc["ring_id"] = ring["ring_id"]
                acc["role"] = role_map[acc["_id"]]["role"]
                acc["role_reason"] = role_map[acc["_id"]]["role_reason"]

    # ── 9. COMPUTE DEFAULT TAINT ─────────────────────────────

    print(f"\n  [9/12] Computing default taint per ring...")
    for ring in rings:
        ring["default_taint"] = compute_default_taint(ring, transactions, accounts)

    # ── 10. COMPUTE DEFAULT FREEZE ───────────────────────────

    print(f"\n  [10/12] Computing default freeze per ring...")
    for ring in rings:
        ring["default_freeze"] = compute_default_freeze(ring, transactions, accounts)

    # ── 11. COMPUTE RECRUITMENT RISK ─────────────────────────

    print(f"\n  [11/12] Computing recruitment risk...")
    all_recruits = []
    for ring in rings:
        ring_member_ids = set(ring["member_ids"])
        recruits = compute_recruitment_risk(
            accounts, ring_member_ids, identifiers, scored_df,
            ring_id=ring["ring_id"]
        )
        all_recruits.extend(recruits)

    # ── 12. BUILD OUTPUT ─────────────────────────────────────

    print(f"\n  [12/12] Writing output files...")
    out_dir = profile_dir / "outputs"
    out_dir.mkdir(parents=True, exist_ok=True)
    root_profile_dir = DATA_DIR / profile
    root_out_dir = root_profile_dir / "outputs"
    root_out_dir.mkdir(parents=True, exist_ok=True)

    # Enrich accounts with scores and signals
    for acc in accounts:
        aid = acc["_id"]
        if aid in scored_df.index:
            acc["risk_v1"] = round(float(scored_df.at[aid, "prob_v1"]), 4)
            acc["risk_v2"] = round(float(scored_df.at[aid, "prob_v2"]), 4)
            acc["features"] = {
                col: round(float(scored_df.at[aid, col]), 4)
                for col in V1_FEATURES
                if col in scored_df.columns
            }
            # Generate signals for flagged accounts
            if scored_df.at[aid, "risk_v2"] >= 0.50 or scored_df.at[aid, "prob_v2"] >= 0.50:
                acc["signals"] = get_signals(aid, scored_df, v2_model, geo=geo)

    # Build alerts (one per ring) per TRD section 6 & ML_INTEGRATION.md section 3.6
    alerts = []
    for ring in rings:
        # fired_at = time of the ring's 3rd member-to-member transfer
        ring_txns = [
            t for t in transactions
            if t["from"] in set(ring["member_ids"]) and t["to"] in set(ring["member_ids"])
        ]
        ring_txns.sort(key=lambda t: t["ts"])
        fired_at = ring_txns[2]["ts"] if len(ring_txns) >= 3 else ring_txns[-1]["ts"] if ring_txns else ""

        alerts.append({
            "_id": f"ALT{ring['ring_id'][-2:]}",
            "ring_id": ring["ring_id"],
            "fired_at": fired_at,
            "reason": f"{len(ring['member_ids'])} linked accounts forwarding within minutes",
        })

    # Metrics document
    metrics_doc = {
        "rows": [
            {
                "model": "V1 transaction only",
                "pr_auc": metrics.get("pr_auc_v1", 0.0),
                "ring_recall": metrics.get("ring_recall", 0.0),
                "pattern_d_recall": metrics.get("pattern_d_recall", 0.0),
            },
            {
                "model": "V2 with identity",
                "pr_auc": metrics.get("pr_auc_v2", 0.0),
                "ring_recall": metrics.get("ring_recall", 0.0),
                "pattern_d_recall": metrics.get("pattern_d_recall", 0.0),
            },
        ],
        "note": "Synthetic data, rings planted by the team",
    }

    # Save to ml/data/<profile>/
    save_json(accounts,     out_dir / "accounts.json")
    save_json(transactions, out_dir / "transactions.json")
    save_json(identifiers,  out_dir / "identifiers.json")
    save_json(rings,        out_dir / "rings.json")
    save_json(alerts,       out_dir / "alerts.json")
    save_json(metrics_doc,  out_dir / "metrics.json")
    save_json(all_recruits, out_dir / "recruits.json")

    # Also save to root data/<profile>/ for direct Express server consumption
    save_json(accounts,     root_profile_dir / "accounts.json")
    save_json(transactions, root_profile_dir / "transactions.json")
    save_json(identifiers,  root_profile_dir / "identifiers.json")
    save_json(ground_truth, root_profile_dir / "ground_truth.json")
    save_json(rings,        root_out_dir / "rings.json")
    save_json(alerts,       root_out_dir / "alerts.json")
    save_json(metrics_doc,  root_out_dir / "metrics.json")
    save_json(all_recruits, root_out_dir / "recruits.json")

    elapsed = time.time() - t0
    print(f"\n{'='*60}")
    print(f"  PIPELINE COMPLETE: {profile.upper()}")
    print(f"  Time: {elapsed:.1f}s")
    print(f"  Rings: {len(rings)}")
    print(f"  Alerts: {len(alerts)}")
    print(f"  Recruits: {len(all_recruits)}")
    print(f"  Output: {out_dir}")
    print(f"{'='*60}\n")

    return {
        "profile": profile,
        "time_seconds": round(elapsed, 1),
        "rings": len(rings),
        "alerts": len(alerts),
        "recruits": len(all_recruits),
        "metrics": metrics,
    }


# ─────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Chakravyuh ML pipeline")
    ap.add_argument("--profile", default="demo",
                    choices=["demo", "train", "test"],
                    help="Which data profile to process")
    ap.add_argument("--geo", action="store_true",
                    help="Include geographic features in V2")
    args = ap.parse_args()

    run_pipeline(args.profile, geo=args.geo)
