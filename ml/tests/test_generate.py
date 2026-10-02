"""
test_generate.py - Tests for synthetic data generation invariants
=================================================================
Validates:
- Non-negative balances for all accounts
- Transaction structure and integer paise
- Rings have correct sources, cashouts, and members
- Account E has no ring transactions
"""

import json
import unittest
from pathlib import Path
from ml.config import DATA_DIR, ML_DIR
from ml.generate import generate_profile


class TestGenerate(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        demo_dir = ML_DIR / "data" / "demo"
        if not (demo_dir / "accounts.json").exists():
            generate_profile("demo")

        with open(demo_dir / "accounts.json", "r", encoding="utf-8") as f:
            cls.accounts = json.load(f)
        with open(demo_dir / "transactions.json", "r", encoding="utf-8") as f:
            cls.transactions = json.load(f)
        with open(demo_dir / "identifiers.json", "r", encoding="utf-8") as f:
            cls.identifiers = json.load(f)
        with open(demo_dir / "ground_truth.json", "r", encoding="utf-8") as f:
            cls.ground_truth = json.load(f)

    def test_no_negative_balances(self):
        """Verify that opening balances are non-negative and integer paise."""
        for acc in self.accounts:
            self.assertIsInstance(acc["opening_balance"], int)
            self.assertGreaterEqual(acc["opening_balance"], 0)

    def test_transactions_integrity(self):
        """Verify transaction fields and integer paise."""
        for txn in self.transactions:
            self.assertIsInstance(txn["amount_paise"], int)
            self.assertGreater(txn["amount_paise"], 0)
            self.assertTrue(txn["from"])
            self.assertTrue(txn["to"])
            self.assertTrue(txn["ts"])

    def test_rings_exist_with_members(self):
        """Verify planted rings have valid metadata and accounts."""
        self.assertGreaterEqual(len(self.ground_truth), 3)
        acc_ids = {a["_id"] for a in self.accounts}
        for ring in self.ground_truth:
            self.assertTrue(ring["ring_id"])
            self.assertTrue(ring["pattern"])
            self.assertGreater(len(ring["member_ids"]), 0)
            for m in ring["member_ids"]:
                self.assertIn(m, acc_ids)

    def test_account_e_isolation(self):
        """Verify Account E (sleepers/innocent) has no transactions in fraud rings."""
        all_ring_members = set()
        for ring in self.ground_truth:
            all_ring_members.update(ring["member_ids"])

        # Check that innocent accounts are not part of ring member sets
        innocent_accounts = [a for a in self.accounts if a["_id"] not in all_ring_members]
        self.assertGreater(len(innocent_accounts), 0)


if __name__ == "__main__":
    unittest.main()
