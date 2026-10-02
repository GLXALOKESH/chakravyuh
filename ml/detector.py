"""
detector.py  —  Blue-Team Fraud Detector (Model 2)
=====================================================
Wraps the existing features.py + models.py infrastructure.
Does NOT duplicate feature extraction or model training.

Public API:
    FraudDetector.train(accounts, transactions, identifiers, ground_truth)
    FraudDetector.detect(accounts, transactions, identifiers)
        -> scored_df, results_list
    FraudDetector.retrain(new_accounts, new_transactions, new_identifiers, new_labels)
"""

import pandas as pd
import numpy as np
from pathlib import Path

try:
    from ml.features import compute_features, V1_FEATURES, v2_features
    from ml.models import (train_models, score_accounts, evaluate,
                          save_models, load_models)
    from ml.config import SAVED_MODELS_DIR, RISK_BAND_THRESHOLDS
except ImportError:
    from features import compute_features, V1_FEATURES, v2_features
    from models import (train_models, score_accounts, evaluate,
                        save_models, load_models)
    from config import SAVED_MODELS_DIR, RISK_BAND_THRESHOLDS


class FraudDetector:
    """
    Blue-team detector that wraps the existing ML infrastructure.
    Uses features.py for feature extraction, models.py for XGBoost/ISO.
    """

    def __init__(self, model_version: str = "v2", geo: bool = False):
        self.model_version = model_version
        self.geo = geo
        self.v1_model = None
        self.v2_model = None
        self.iso_model = None
        self.scaler = None
        self.is_trained = False

        # Accumulated training data for incremental retraining
        self._train_accounts = []
        self._train_transactions = []
        self._train_identifiers = []
        self._train_fraud_ids = set()

    def train(self, accounts: list, transactions: list,
              identifiers: list, ground_truth: list):
        """
        Train the detector from scratch on provided data.

        Uses features.compute_features() and models.train_models().
        """
        print("  [detector] Training on baseline data...")

        # Store training data for incremental retraining
        self._train_accounts = list(accounts)
        self._train_transactions = list(transactions)
        self._train_identifiers = list(identifiers)

        # Build fraud label set
        self._train_fraud_ids = set()
        for ring in ground_truth:
            self._train_fraud_ids.update(ring["member_ids"])

        # Compute features (single source of truth: features.py)
        df = compute_features(accounts, transactions, identifiers, geo=self.geo)

        # Build labels
        labels = pd.Series({aid: aid in self._train_fraud_ids for aid in df.index})

        # Train models (single source of truth: models.py)
        self.v1_model, self.v2_model, self.iso_model, self.scaler = \
            train_models(df, labels, geo=self.geo)

        self.is_trained = True
        print("  [detector] Training complete.")

    def detect(self, accounts: list, transactions: list,
               identifiers: list) -> tuple:
        """
        Run detection on a dataset.

        Returns:
            scored_df    DataFrame with risk scores and features
            results      list of structured result dicts per account
        """
        if not self.is_trained:
            raise RuntimeError("Detector not trained. Call train() first.")

        # Compute features
        df = compute_features(accounts, transactions, identifiers, geo=self.geo)

        # Score accounts
        scored_df = score_accounts(df, self.v1_model, self.v2_model,
                                   self.iso_model, geo=self.geo)

        # Build structured results
        results = []
        for aid in scored_df.index:
            row = scored_df.loc[aid]
            prob = float(row.get("prob_v2", 0.0))
            risk_label = _risk_band(prob)

            results.append({
                "entity_id":        aid,
                "risk_score":       float(row.get("risk_v2", 0)),
                "risk_label":       risk_label,
                "model_version":    self.model_version,
                "detected_features": [],
                "graph_metrics":    {},
                "role":             "UNKNOWN",
            })

        return scored_df, results

    def retrain(self, new_accounts: list, new_transactions: list,
                new_identifiers: list, new_fraud_ids: set):
        """
        Incrementally retrain the detector by appending new data
        to the existing training set.

        CRITICAL: Only call this AFTER evaluating on adversarial test data.
        Do NOT leak test data into training before evaluation.
        """
        print("  [detector] Retraining with augmented data...")

        # Merge new data into training pool
        existing_ids = {a["_id"] for a in self._train_accounts}
        for acc in new_accounts:
            if acc["_id"] not in existing_ids:
                self._train_accounts.append(acc)
                existing_ids.add(acc["_id"])

        self._train_transactions.extend(new_transactions)

        # Merge identifiers (upsert by _id)
        id_map = {r["_id"]: r for r in self._train_identifiers}
        for rec in new_identifiers:
            if rec["_id"] in id_map:
                existing = id_map[rec["_id"]]
                for a in rec["account_ids"]:
                    if a not in existing["account_ids"]:
                        existing["account_ids"].append(a)
            else:
                id_map[rec["_id"]] = rec
                self._train_identifiers.append(rec)

        # Update fraud labels
        self._train_fraud_ids.update(new_fraud_ids)

        # Re-compute features on full training pool
        df = compute_features(
            self._train_accounts, self._train_transactions,
            self._train_identifiers, geo=self.geo
        )
        labels = pd.Series({aid: aid in self._train_fraud_ids for aid in df.index})

        # Retrain
        self.v1_model, self.v2_model, self.iso_model, self.scaler = \
            train_models(df, labels, geo=self.geo)

        print("  [detector] Retrained.")

    def evaluate_on(self, accounts: list, transactions: list,
                    identifiers: list, ground_truth: list) -> dict:
        """
        Evaluate detector performance on a given dataset.
        Returns metrics dict from models.evaluate().
        """
        if not self.is_trained:
            raise RuntimeError("Detector not trained.")

        df = compute_features(accounts, transactions, identifiers, geo=self.geo)
        scored = score_accounts(df, self.v1_model, self.v2_model,
                                self.iso_model, geo=self.geo)
        return evaluate(scored, ground_truth)


def _risk_band(prob: float) -> str:
    """Map a 0-1 probability to a risk band string."""
    if prob >= RISK_BAND_THRESHOLDS["CRITICAL"]:
        return "CRITICAL"
    elif prob >= RISK_BAND_THRESHOLDS["HIGH"]:
        return "HIGH"
    elif prob >= RISK_BAND_THRESHOLDS["MEDIUM"]:
        return "MEDIUM"
    return "LOW"
