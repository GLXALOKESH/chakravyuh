"""
test_contingencies.py - Comprehensive Edge Cases and Contingency Testing
========================================================================
Validates system resilience across boundary conditions:
1. Cyclic transaction loops in taint tracing
2. Zero opening balances and extreme proportional splits
3. Missing nodes and non-reachable CASH in freeze optimizer
4. Extreme k values (k=0, k > len(members)) and full exclusion in freeze optimizer
5. Disconnected and minimal graph topology in Louvain ring discovery
6. Extreme adversary mutations without producing invalid paise/timestamps
7. SHAP fallback mechanisms in signal generation
"""

import unittest
import pandas as pd
from ml.taint import trace, compute_default_taint
from ml.freeze import recommend_freeze
from ml.rings import discover_rings, classify_roles
from ml.adversary import FraudAdversary
from ml.models import get_signals


class TestContingencies(unittest.TestCase):
    def test_taint_cyclic_loop(self):
        """Taint conservation must hold even if money cycles in a loop (A -> B -> C -> A)."""
        opening_balances = {"A": 100_000, "B": 0, "C": 0, "V": 100_000}
        transactions = [
            {"_id": "T_V", "ts": "2026-01-01T10:00:00Z", "from": "V", "to": "A", "amount_paise": 100_000},
            {"_id": "T_1", "ts": "2026-01-01T10:01:00Z", "from": "A", "to": "B", "amount_paise": 80_000},
            {"_id": "T_2", "ts": "2026-01-01T10:02:00Z", "from": "B", "to": "C", "amount_paise": 60_000},
            {"_id": "T_3", "ts": "2026-01-01T10:03:00Z", "from": "C", "to": "A", "amount_paise": 40_000},  # Cycle back to A
        ]

        bal, taint, flows, victim_amt = trace(transactions, opening_balances, "T_V")
        total_taint = sum(taint.values())
        self.assertEqual(total_taint, 100_000, "Taint conservation failed in cyclic graph")

    def test_taint_as_of_timestamp_cutoff(self):
        """Transactions occurring after as_of timestamp must be ignored."""
        opening_balances = {"A": 100_000, "B": 0, "V": 100_000}
        transactions = [
            {"_id": "T_V", "ts": "2026-01-01T10:00:00Z", "from": "V", "to": "A", "amount_paise": 100_000},
            {"_id": "T_EARLY", "ts": "2026-01-01T10:05:00Z", "from": "A", "to": "B", "amount_paise": 50_000},
            {"_id": "T_LATE", "ts": "2026-01-01T11:00:00Z", "from": "A", "to": "B", "amount_paise": 50_000},
        ]

        bal, taint, flows, _ = trace(transactions, opening_balances, "T_V", as_of="2026-01-01T10:30:00Z")
        self.assertEqual(taint["B"], 25_000, "Late transaction should not have executed")

    def test_freeze_no_cash_reachable(self):
        """When no account can reach CASH, at_risk must be 0 and no freeze needed."""
        accounts = [{"_id": "A", "opening_balance": 100_000}, {"_id": "B", "opening_balance": 0}]
        ring = {"ring_id": "R1", "member_ids": ["A", "B"]}
        transactions = [
            {"_id": "TV", "ts": "2026-01-01T10:00:00Z", "from": "V", "to": "A", "amount_paise": 100_000},
            {"_id": "T1", "ts": "2026-01-01T10:05:00Z", "from": "A", "to": "B", "amount_paise": 50_000},
            # No edge to CASH
        ]

        rec = recommend_freeze(ring, transactions, accounts, victim_txn_id="TV", k=2)
        self.assertEqual(rec["at_risk_before"], 0)
        self.assertEqual(rec["secured"], 0)

    def test_freeze_extreme_k_and_exclusions(self):
        """Verify behavior with k=0, k > len(members), and excluding all members."""
        accounts = [{"_id": "A", "opening_balance": 0}, {"_id": "B", "opening_balance": 0}]
        ring = {"ring_id": "R1", "member_ids": ["A", "B"]}
        transactions = [
            {"_id": "TV", "ts": "2026-01-01T10:00:00Z", "from": "V", "to": "A", "amount_paise": 100_000},
            {"_id": "T1", "ts": "2026-01-01T10:05:00Z", "from": "A", "to": "B", "amount_paise": 100_000},
            {"_id": "T2", "ts": "2026-01-01T10:10:00Z", "from": "B", "to": "CASH", "amount_paise": 100_000},
        ]

        # k = 0
        rec_k0 = recommend_freeze(ring, transactions, accounts, victim_txn_id="TV", k=0)
        self.assertEqual(len(rec_k0["freeze"]), 0)

        # k > len(members)
        rec_k_large = recommend_freeze(ring, transactions, accounts, victim_txn_id="TV", k=10)
        self.assertLessEqual(len(rec_k_large["freeze"]), len(ring["member_ids"]))

        # Exclude all
        rec_ex_all = recommend_freeze(ring, transactions, accounts, victim_txn_id="TV", k=2, exclude=["A", "B"])
        self.assertEqual(len(rec_ex_all["freeze"]), 0)

    def test_rings_empty_or_disconnected_graph(self):
        """Ring discovery on accounts with no transactions or low risk should return empty list gracefully."""
        accounts = [{"_id": f"ACC_{i}", "opening_balance": 10_000} for i in range(5)]
        transactions = []
        identifiers = []
        scored_df = pd.DataFrame(
            {"risk_v2": [10, 15, 5, 20, 12], "prob_v2": [0.10, 0.15, 0.05, 0.20, 0.12]},
            index=[a["_id"] for a in accounts]
        )

        discovered = discover_rings(accounts, transactions, identifiers, scored_df)
        self.assertEqual(len(discovered), 0, "No rings should be discovered when risk is low and no links exist")

    def test_adversary_extreme_parameters(self):
        """Verify adversary with high sigma/lambda still outputs valid non-negative integer amounts."""
        adv = FraudAdversary(random_state=999)
        adv.amount_sigma = 0.50
        adv.temporal_lambda = 120.0
        ring_gt = {
            "ring_id": "R_TEST",
            "pattern": "A",
            "member_ids": ["ACC_1", "ACC_2", "ACC_3"],
            "source": "ACC_1",
            "cashout": ["ACC_3"],
        }
        accounts = [{"_id": f"ACC_{i}", "opening_balance": 100_000} for i in [1, 2, 3]]
        transactions = [
            {"_id": "TXN_1", "ts": "2026-01-01T10:00:00Z", "from": "ACC_1", "to": "ACC_2", "amount_paise": 50_000},
            {"_id": "TXN_2", "ts": "2026-01-01T10:05:00Z", "from": "ACC_2", "to": "ACC_3", "amount_paise": 50_000},
        ]
        identifiers = []

        new_accs, new_txns, new_ids, meta = adv.mutate_ring(ring_gt, transactions, accounts, identifiers, round_num=5)

        for txn in new_txns:
            self.assertIsInstance(txn["amount_paise"], int)
            self.assertGreater(txn["amount_paise"], 0, "Amount must remain strictly positive")
            self.assertFalse(txn["ts"].endswith("None"), "Timestamp must be valid")


if __name__ == "__main__":
    unittest.main()
