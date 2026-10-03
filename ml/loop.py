"""
loop.py  —  Ouroboros Adversarial Self-Improving Loop
=======================================================
Runs the continuous battle between Model 1 (Adversary) and Model 2 (Detector).

Each round:
    1. Load baseline fraud data
    2. Extract features (via detector, which calls features.py)
    3. Train/evaluate detector
    4. Red team generates adversarial variants
    5. Blue team runs detector on variants
    6. Identify missed adversarial cases
    7. Record metrics
    8. Update detector training data (ONLY after evaluation)
    9. Repeat
    10. Export final results

CRITICAL: No data leakage. Adversarial test data is NEVER in training
          before evaluation.

Public API:
    run_ouroboros(n_rounds, profile, seed) -> results dict

Usage:
    python loop.py
    python loop.py --rounds 5 --profile demo
"""

import argparse
import copy
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

# Ensure ml/ is on the path
ML_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ML_DIR))

from adversary import FraudAdversary
from detector import FraudDetector
from features import compute_features
from models import score_accounts, evaluate
from config import GLOBAL_SEED


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


# ─────────────────────────────────────────────────────────────────
# OUROBOROS LOOP
# ─────────────────────────────────────────────────────────────────

def run_ouroboros(n_rounds: int = 3, profile: str = "demo",
                 seed: int = GLOBAL_SEED) -> dict:
    """
    Run the adversarial self-improving loop.

    Returns:
        {
            "rounds": [...],         # per-round metrics
            "config": {...},         # experiment configuration
            "summary": {...},        # final comparison
        }
    """
    t0 = time.time()
    data_root = ML_DIR / "data"
    profile_dir = data_root / profile

    print(f"\n{'='*60}")
    print(f"  OUROBOROS: {n_rounds} rounds on {profile.upper()}")
    print(f"{'='*60}")

    # ── Load baseline data ────────────────────────────────────

    accounts     = load_json(profile_dir / "accounts.json")
    transactions = load_json(profile_dir / "transactions.json")
    identifiers  = load_json(profile_dir / "identifiers.json")
    ground_truth = load_json(profile_dir / "ground_truth.json")

    print(f"  Loaded: {len(accounts)} accounts, {len(transactions)} txns, "
          f"{len(ground_truth)} rings")

    # ── Initialize models ─────────────────────────────────────

    adversary = FraudAdversary(random_state=seed)
    detector  = FraudDetector(model_version="v2")

    # Experiment config
    config = {
        "n_rounds":         n_rounds,
        "profile":          profile,
        "seed":             seed,
        "initial_accounts": len(accounts),
        "initial_txns":     len(transactions),
        "initial_rings":    len(ground_truth),
        "amount_sigma":     adversary.amount_sigma,
        "temporal_lambda":  adversary.temporal_lambda,
    }

    round_results = []

    # ── ROUND 0: BASELINE ─────────────────────────────────────

    print(f"\n{'-'*50}")
    print(f"  ROUND 0 - BASELINE")
    print(f"{'-'*50}")

    # Train detector on baseline data
    detector.train(accounts, transactions, identifiers, ground_truth)

    # Evaluate baseline performance
    scored_df, _ = detector.detect(accounts, transactions, identifiers)

    # Build ground truth labels
    fraud_ids = set()
    for ring in ground_truth:
        fraud_ids.update(ring["member_ids"])

    baseline_gt = [{"member_ids": list(fraud_ids), "pattern": "baseline"}]
    baseline_metrics = evaluate(scored_df, ground_truth)

    print(f"  Baseline PR-AUC V1: {baseline_metrics['pr_auc_v1']:.4f}")
    print(f"  Baseline PR-AUC V2: {baseline_metrics['pr_auc_v2']:.4f}")
    print(f"  Baseline Ring Recall: {baseline_metrics['ring_recall']:.4f}")

    round_results.append({
        "round": 0,
        "type": "baseline",
        "metrics": baseline_metrics,
        "adversary_config": None,
        "n_adversarial_txns": 0,
        "n_missed": 0,
        "n_detected": 0,
        "evasion_rate": 0.0,
    })

    # ── ROUNDS 1..N ───────────────────────────────────────────

    # Separate lists for adversarial data (accumulate across rounds)
    adv_accounts_pool = []
    adv_txns_pool = []
    adv_ids_pool = []
    adv_fraud_ids_pool = set()
    all_metadata = []

    for round_num in range(1, n_rounds + 1):
        print(f"\n{'-'*50}")
        print(f"  ROUND {round_num} / {n_rounds}")
        print(f"{'-'*50}")

        # ── RED TEAM: mutate existing rings ───────────────────

        print(f"  [RED] Generating adversarial variants...")

        round_adv_accounts = []
        round_adv_txns = []
        round_adv_ids = []
        round_adv_fraud = set()
        round_metadata = []

        for ring_gt in ground_truth:
            new_accs, new_txns, new_ids, meta = adversary.mutate_ring(
                ring_gt, transactions, accounts, identifiers, round_num
            )
            round_adv_accounts.extend(new_accs)
            round_adv_txns.extend(new_txns)
            round_adv_ids.extend(new_ids)
            # All adversarial accounts are fraud
            for acc in new_accs:
                round_adv_fraud.add(acc["_id"])
            # Original ring members in mutated txns are also fraud
            for aid in ring_gt["member_ids"]:
                round_adv_fraud.add(aid)
            round_metadata.append(meta)

        print(f"  [RED] Generated {len(round_adv_txns)} adversarial txns, "
              f"{len(round_adv_accounts)} new accounts")

        # ── BLUE TEAM: detect adversarial data ────────────────

        print(f"  [BLUE] Running detector on adversarial data...")

        # Combine baseline + adversarial for detection
        # (detector sees the adversarial data mixed with normal)
        detect_accounts = accounts + round_adv_accounts
        detect_txns = transactions + round_adv_txns
        detect_ids = identifiers + round_adv_ids

        adv_scored_df, adv_results = detector.detect(
            detect_accounts, detect_txns, detect_ids
        )

        # ── EVALUATE: missed vs detected ──────────────────────

        max_v = adv_scored_df["risk_v2"].max() if "risk_v2" in adv_scored_df.columns and len(adv_scored_df) > 0 else 1.0
        threshold = 0.50 if max_v <= 1.0 else 50   # risk_v2 threshold for "detected"
        detected_adv = set()
        missed_adv = set()

        for aid in round_adv_fraud:
            if aid in adv_scored_df.index:
                if adv_scored_df.at[aid, "risk_v2"] >= threshold:
                    detected_adv.add(aid)
                else:
                    missed_adv.add(aid)
            else:
                missed_adv.add(aid)

        total_adv = len(round_adv_fraud)
        evasion_rate = len(missed_adv) / max(total_adv, 1)
        detection_rate = len(detected_adv) / max(total_adv, 1)

        print(f"  [EVAL] Adversarial accounts: {total_adv}")
        print(f"         Detected: {len(detected_adv)} ({detection_rate:.1%})")
        print(f"         Missed:   {len(missed_adv)} ({evasion_rate:.1%})")

        # Build evaluation ground truth for adversarial data
        adv_gt = [{
            "member_ids": list(round_adv_fraud),
            "pattern": "adversarial",
        }]
        adv_eval_metrics = evaluate(adv_scored_df, adv_gt)

        # ── FEEDBACK: adapt adversary ─────────────────────────

        adversary.adapt_strategy(
            missed_adv, detected_adv,
            [m.get("mutation_types", []) for m in round_metadata]
        )

        # ── RECORD METRICS ────────────────────────────────────

        round_results.append({
            "round":              round_num,
            "type":               "adversarial",
            "metrics":            adv_eval_metrics,
            "adversary_config": {
                "amount_sigma":   adversary.amount_sigma,
                "temporal_lambda": adversary.temporal_lambda,
                "strategy_weights": dict(adversary.strategy_weights),
            },
            "n_adversarial_txns": len(round_adv_txns),
            "n_adversarial_accs": len(round_adv_accounts),
            "n_detected":         len(detected_adv),
            "n_missed":           len(missed_adv),
            "evasion_rate":       round(evasion_rate, 4),
            "detection_rate":     round(detection_rate, 4),
            "mutation_metadata":  round_metadata,
        })

        # ── RETRAIN: update detector ──────────────────────────
        # CRITICAL: This happens AFTER evaluation.
        # Only detected adversarial examples enter training.

        print(f"  [BLUE] Retraining with {len(detected_adv)} detected adversarial samples...")

        # Add detected adversarial data to training pool
        detected_accs = [a for a in round_adv_accounts if a["_id"] in detected_adv]
        detected_txns = [t for t in round_adv_txns
                         if t["from"] in detected_adv or t["to"] in detected_adv]

        detector.retrain(
            detected_accs, detected_txns, round_adv_ids, detected_adv
        )

        # Accumulate all adversarial data for final summary
        adv_accounts_pool.extend(round_adv_accounts)
        adv_txns_pool.extend(round_adv_txns)
        adv_ids_pool.extend(round_adv_ids)
        adv_fraud_ids_pool.update(round_adv_fraud)
        all_metadata.extend(round_metadata)

    # ── FINAL EVALUATION ──────────────────────────────────────

    print(f"\n{'-'*50}")
    print(f"  FINAL EVALUATION")
    print(f"{'-'*50}")

    # Evaluate final detector on ALL accumulated adversarial data
    final_detect_accounts = accounts + adv_accounts_pool
    final_detect_txns = transactions + adv_txns_pool
    final_detect_ids = identifiers + adv_ids_pool

    final_scored_df, _ = detector.detect(
        final_detect_accounts, final_detect_txns, final_detect_ids
    )

    final_gt = [{"member_ids": list(adv_fraud_ids_pool), "pattern": "all_adversarial"}]
    final_metrics = evaluate(final_scored_df, final_gt)

    # Also evaluate on original baseline
    baseline_scored_df, _ = detector.detect(accounts, transactions, identifiers)
    post_train_baseline = evaluate(baseline_scored_df, ground_truth)

    print(f"  Final adversarial PR-AUC V2: {final_metrics['pr_auc_v2']:.4f}")
    print(f"  Post-training baseline recall: {post_train_baseline['ring_recall']:.4f}")

    # ── BUILD SUMMARY ─────────────────────────────────────────

    summary = {
        "baseline": {
            "pr_auc_v1":    baseline_metrics["pr_auc_v1"],
            "pr_auc_v2":    baseline_metrics["pr_auc_v2"],
            "ring_recall":  baseline_metrics["ring_recall"],
        },
        "final_adversarial": {
            "pr_auc_v2":    final_metrics["pr_auc_v2"],
            "ring_recall":  final_metrics["ring_recall"],
        },
        "post_training_baseline": {
            "pr_auc_v1":    post_train_baseline["pr_auc_v1"],
            "pr_auc_v2":    post_train_baseline["pr_auc_v2"],
            "ring_recall":  post_train_baseline["ring_recall"],
        },
        "improvement": {
            "description": "Comparison of original vs adversarial vs post-training detection",
            "original_detection_rate": baseline_metrics["ring_recall"],
            "adversarial_detection_rate": final_metrics.get("ring_recall", 0),
            "post_training_detection_rate": post_train_baseline["ring_recall"],
        },
        "total_adversarial_accounts": len(adv_accounts_pool),
        "total_adversarial_txns":     len(adv_txns_pool),
        "total_rounds":               n_rounds,
    }

    elapsed = time.time() - t0

    results = {
        "rounds":  round_results,
        "config":  config,
        "summary": summary,
        "elapsed_seconds": round(elapsed, 1),
    }

    # Save results
    out_dir = profile_dir / "outputs"
    out_dir.mkdir(parents=True, exist_ok=True)
    save_json(results, out_dir / "ouroboros_results.json")

    print(f"\n{'='*60}")
    print(f"  OUROBOROS COMPLETE")
    print(f"  Time: {elapsed:.1f}s")
    print(f"  Results: {out_dir / 'ouroboros_results.json'}")
    print(f"{'='*60}\n")

    # Print comparison table
    print(f"  {'Metric':<30} {'Baseline':>10} {'Adversarial':>12} {'Post-Train':>12}")
    print(f"  {'-'*66}")
    print(f"  {'PR-AUC V2':<30} {baseline_metrics['pr_auc_v2']:>10.4f} "
          f"{final_metrics['pr_auc_v2']:>12.4f} "
          f"{post_train_baseline['pr_auc_v2']:>12.4f}")
    print(f"  {'Ring Recall':<30} {baseline_metrics['ring_recall']:>10.4f} "
          f"{final_metrics.get('ring_recall', 0):>12.4f} "
          f"{post_train_baseline['ring_recall']:>12.4f}")
    print()

    return results


# ─────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Chakravyuh Ouroboros Loop")
    ap.add_argument("--rounds", type=int, default=3,
                    help="Number of adversarial rounds (default: 3)")
    ap.add_argument("--profile", default="demo",
                    choices=["demo", "train", "test"],
                    help="Data profile to use")
    ap.add_argument("--seed", type=int, default=GLOBAL_SEED,
                    help="Random seed for reproducibility")
    args = ap.parse_args()

    run_ouroboros(n_rounds=args.rounds, profile=args.profile, seed=args.seed)
