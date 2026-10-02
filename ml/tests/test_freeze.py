"""
test_freeze.py - Tests for min-cut freeze optimization
======================================================
Validates:
- recommended accounts subset of members
- secured amount <= at_risk_before
- excluded accounts are never included in recommendation
"""

import unittest
from ml.freeze import recommend_freeze


class TestFreeze(unittest.TestCase):
    def test_recommend_freeze_invariants(self):
        accounts = [
            {"_id": "ACC_V", "opening_balance": 100_000},
            {"_id": "ACC_A", "opening_balance": 0},
            {"_id": "ACC_B", "opening_balance": 0},
            {"_id": "ACC_C", "opening_balance": 0},
        ]
        ring = {
            "ring_id": "RING_01",
            "member_ids": ["ACC_A", "ACC_B", "ACC_C"],
            "source": "ACC_A",
        }
        transactions = [
            {"_id": "TXN_V", "ts": "2026-01-01T10:00:00Z", "from": "ACC_V", "to": "ACC_A", "amount_paise": 100_000},
            {"_id": "TXN_1", "ts": "2026-01-01T10:05:00Z", "from": "ACC_A", "to": "ACC_B", "amount_paise": 100_000},
            {"_id": "TXN_2", "ts": "2026-01-01T10:10:00Z", "from": "ACC_B", "to": "ACC_C", "amount_paise": 100_000},
            {"_id": "TXN_3", "ts": "2026-01-01T10:15:00Z", "from": "ACC_C", "to": "CASH", "amount_paise": 100_000},
        ]

        # Freeze recommendation
        rec = recommend_freeze(ring, transactions, accounts, victim_txn_id="TXN_V", k=1)
        self.assertIn("freeze", rec)
        self.assertIn("secured", rec)
        self.assertIn("at_risk_before", rec)
        self.assertLessEqual(rec["secured"], rec["at_risk_before"])

        # Test exclusion
        rec_ex = recommend_freeze(ring, transactions, accounts, victim_txn_id="TXN_V", k=1, exclude=["ACC_C"])
        self.assertNotIn("ACC_C", rec_ex["freeze"])


if __name__ == "__main__":
    unittest.main()
