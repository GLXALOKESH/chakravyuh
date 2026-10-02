"""
test_taint.py - Tests for proportional taint tracing invariants
===============================================================
Validates:
- Conservation invariant: sum(taint.values()) == victim_amount_paise
- Integer paise arithmetic (no floats)
- Correct handling of transfers and flow tracking
"""

import unittest
from ml.taint import trace, compute_default_taint


class TestTaint(unittest.TestCase):
    def test_taint_conservation(self):
        """Conservation invariant test on synthetic chain."""
        opening_balances = {
            "ACC_V": 100_000,
            "ACC_1": 50_000,
            "ACC_2": 20_000,
            "ACC_3": 10_000,
            "CASH": 0,
        }

        victim_amount = 100_000  # 1000 INR

        transactions = [
            # Victim transfers to ACC_1
            {"_id": "TXN_VIC", "ts": "2026-01-01T10:00:00Z", "from": "ACC_V", "to": "ACC_1", "amount_paise": victim_amount},
            # ACC_1 balance was 50k + 100k = 150k. Taint is 100k (2/3).
            # ACC_1 transfers 75k to ACC_2. Taint moved = (75k * 100k) // 150k = 50k.
            {"_id": "TXN_1", "ts": "2026-01-01T10:05:00Z", "from": "ACC_1", "to": "ACC_2", "amount_paise": 75_000},
            # ACC_2 balance was 20k + 75k = 95k. Taint is 50k.
            # ACC_2 transfers 38k to ACC_3. Taint moved = (38k * 50k) // 95k = 20k.
            {"_id": "TXN_2", "ts": "2026-01-01T10:10:00Z", "from": "ACC_2", "to": "ACC_3", "amount_paise": 38_000},
            # ACC_3 cashes out 15k to CASH. ACC_3 bal was 10k + 38k = 48k. Taint is 20k.
            # Taint moved = (15k * 20k) // 48k = 6250.
            {"_id": "TXN_3", "ts": "2026-01-01T10:15:00Z", "from": "ACC_3", "to": "CASH", "amount_paise": 15_000},
        ]

        bal, taint, flows, returned_victim_amount = trace(transactions, opening_balances, "TXN_VIC")

        self.assertEqual(returned_victim_amount, victim_amount)

        # Invariant check: sum of all tainted funds must equal victim amount
        total_tainted = sum(taint.values())
        self.assertEqual(total_tainted, victim_amount, f"Conservation violated: sum is {total_tainted}, expected {victim_amount}")

        # Integer type checks
        for acc_id, t_val in taint.items():
            self.assertIsInstance(t_val, int)
            self.assertGreaterEqual(t_val, 0)

        for (u, v), flow_val in flows.items():
            self.assertIsInstance(flow_val, int)
            self.assertGreaterEqual(flow_val, 0)


if __name__ == "__main__":
    unittest.main()
