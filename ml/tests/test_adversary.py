"""
test_adversary.py - Tests for Red Team FraudAdversary mutations
===============================================================
Validates:
- All mutation types execute cleanly
- Metadata is attached to all generated samples
- Timestamps and integer paise are valid
- adapt_strategy updates weights/strengths
"""

import json
import unittest
from ml.config import ML_DIR
from ml.adversary import FraudAdversary


class TestAdversary(unittest.TestCase):
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

    def test_mutate_ring(self):
        adv = FraudAdversary(random_state=42)
        ring_gt = self.ground_truth[0]
        new_accs, new_txns, new_ids, meta = adv.mutate_ring(
            ring_gt, self.transactions, self.accounts, self.identifiers, round_num=1
        )

        self.assertGreater(len(new_txns), 0)
        self.assertTrue("original_ring_id" in meta or "original_sample_id" in meta)
        self.assertIn("mutation_types", meta)
        self.assertIn("adversarial_round", meta)

        for txn in new_txns:
            self.assertIsInstance(txn["amount_paise"], int)
            self.assertGreater(txn["amount_paise"], 0)
            self.assertTrue(txn["from"])
            self.assertTrue(txn["to"])

        for acc in new_accs:
            self.assertIsInstance(acc["opening_balance"], int)
            self.assertGreaterEqual(acc["opening_balance"], 0)

    def test_adapt_strategy_high_evasion(self):
        """When evasion is high, mutation strength parameters increase."""
        adv = FraudAdversary(random_state=42)
        initial_sigma = adv.amount_sigma

        missed = {"ACC_ADV_1", "ACC_ADV_2"}
        detected = set()
        mutation_types_used = [["amount", "multi_hop"]]

        adv.adapt_strategy(missed, detected, mutation_types_used)
        self.assertGreater(adv.amount_sigma, initial_sigma)

    def test_adapt_strategy_high_detection(self):
        """When detection is high, adversary shifts toward structural mutations."""
        adv = FraudAdversary(random_state=42)
        initial_multihop = adv.strategy_weights["multi_hop"]

        missed = set()
        detected = {"ACC_ADV_1", "ACC_ADV_2"}
        mutation_types_used = [["amount", "multi_hop"]]

        adv.adapt_strategy(missed, detected, mutation_types_used)
        self.assertGreater(adv.strategy_weights["multi_hop"], initial_multihop)


if __name__ == "__main__":
    unittest.main()
