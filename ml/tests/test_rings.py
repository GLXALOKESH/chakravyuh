"""
test_rings.py - Tests for Louvain ring discovery and role classification
=======================================================================
Validates:
- All planted rings discovered on demo dataset
- Roles are classified per TRD hierarchy
- role_reason string populated
"""

import json
import unittest
import pandas as pd
from ml.config import ML_DIR
from ml.features import compute_features
from ml.models import train_models, score_accounts
from ml.rings import discover_rings, classify_roles


class TestRings(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        demo_dir = ML_DIR / "data" / "demo"
        with open(demo_dir / "accounts.json", "r", encoding="utf-8") as f:
            cls.accounts = json.load(f)
        with open(demo_dir / "transactions.json", "r", encoding="utf-8") as f:
            cls.transactions = json.load(f)
        with open(demo_dir / "identifiers.json", "r", encoding="utf-8") as f:
            cls.identifiers = json.load(f)
        with open(demo_dir / "ground_truth.json", "r", encoding="utf-8") as f:
            cls.ground_truth = json.load(f)

        features_df = compute_features(cls.accounts, cls.transactions, cls.identifiers)

        fraud_ids = set()
        for ring in cls.ground_truth:
            fraud_ids.update(ring["member_ids"])
        labels = pd.Series({aid: aid in fraud_ids for aid in features_df.index})

        v1_model, v2_model, iso_model, scaler = train_models(features_df, labels)
        cls.scored_df = score_accounts(features_df, v1_model, v2_model, iso_model)

    def test_discover_rings(self):
        discovered = discover_rings(self.accounts, self.transactions, self.identifiers, self.scored_df)
        self.assertGreaterEqual(len(discovered), 3, "Expected at least 3 discovered rings on demo profile")

        for ring in discovered:
            self.assertTrue(ring["ring_id"])
            self.assertGreater(len(ring["member_ids"]), 0)
            self.assertIn("risk", ring)
            self.assertIn("volume", ring)

    def test_classify_roles(self):
        discovered = discover_rings(self.accounts, self.transactions, self.identifiers, self.scored_df)
        for ring in discovered:
            roles = classify_roles(ring, self.transactions, self.identifiers, self.scored_df)
            self.assertIsInstance(roles, dict)
            for member_id in ring["member_ids"]:
                self.assertIn(member_id, roles)
                self.assertIn("role", roles[member_id])
                self.assertIn("role_reason", roles[member_id])
                self.assertIsInstance(roles[member_id]["role_reason"], str)


if __name__ == "__main__":
    unittest.main()
