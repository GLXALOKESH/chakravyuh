"""
test_temporal.py  —  Unit Tests for Temporal Fund-Flow Engine
============================================================
Validates time-consistent multi-hop traversal, strict timestamp ordering,
cycle prevention, CASH termination, integer paise preservation, determinism,
and truncation visibility.
"""

import unittest
from datetime import datetime, timezone

from ml.temporal import analyze_temporal_fund_flows


class TestTemporalFundFlow(unittest.TestCase):
    def test_01_simple_linear_chain(self):
        """1. Simple linear chain: A -> B -> C -> CASH with strictly increasing timestamps."""
        txns = [
            {
                "_id": "TXN_01",
                "ts": "2026-09-20T10:00:00Z",
                "from": "ACC_A",
                "to": "ACC_B",
                "amount_paise": 5000000,
            },
            {
                "_id": "TXN_02",
                "ts": "2026-09-20T10:15:00Z",
                "from": "ACC_B",
                "to": "ACC_C",
                "amount_paise": 4800000,
            },
            {
                "_id": "TXN_03",
                "ts": "2026-09-20T10:45:00Z",
                "from": "ACC_C",
                "to": "CASH",
                "amount_paise": 4500000,
            },
        ]

        result = analyze_temporal_fund_flows(txns, min_hops=3, max_hops=5)

        self.assertEqual(result["summary"]["total_paths_identified"], 1)
        self.assertFalse(result["summary"]["truncated"])
        path = result["paths"][0]
        self.assertEqual(path["hops"], 3)
        self.assertEqual(path["start_time"], "2026-09-20T10:00:00Z")
        self.assertEqual(path["end_time"], "2026-09-20T10:45:00Z")
        self.assertEqual(path["duration_minutes"], 45.0)
        self.assertEqual(path["initial_amount_paise"], 5000000)
        self.assertEqual(path["final_amount_paise"], 4500000)
        self.assertEqual(path["amount_decay_pct"], 10.0)  # (5M - 4.5M) / 5M = 10%

        # Check chain latencies
        chain = path["chain"]
        self.assertIsNone(chain[0]["latency_from_prev_min"])
        self.assertEqual(chain[1]["latency_from_prev_min"], 15.0)  # 10:00 to 10:15
        self.assertEqual(chain[2]["latency_from_prev_min"], 30.0)  # 10:15 to 10:45

    def test_02_same_timestamp_rejection(self):
        """2. Same-timestamp rejection: A -> B at T1, B -> C at T1 (non-causal)."""
        txns = [
            {
                "_id": "TXN_01",
                "ts": "2026-09-20T10:00:00Z",
                "from": "ACC_A",
                "to": "ACC_B",
                "amount_paise": 100000,
            },
            {
                "_id": "TXN_02",
                "ts": "2026-09-20T10:00:00Z",
                "from": "ACC_B",
                "to": "ACC_C",
                "amount_paise": 100000,
            },
        ]

        result = analyze_temporal_fund_flows(txns, min_hops=2)
        self.assertEqual(result["summary"]["total_paths_identified"], 0)
        self.assertFalse(result["summary"]["truncated"])
        self.assertEqual(len(result["paths"]), 0)

    def test_03_reverse_time_rejection(self):
        """3. Reverse-time rejection: A -> B at T2, B -> C at T1."""
        txns = [
            {
                "_id": "TXN_01",
                "ts": "2026-09-20T10:30:00Z",
                "from": "ACC_A",
                "to": "ACC_B",
                "amount_paise": 100000,
            },
            {
                "_id": "TXN_02",
                "ts": "2026-09-20T10:00:00Z",
                "from": "ACC_B",
                "to": "ACC_C",
                "amount_paise": 100000,
            },
        ]

        result = analyze_temporal_fund_flows(txns, min_hops=2)
        self.assertEqual(result["summary"]["total_paths_identified"], 0)
        self.assertFalse(result["summary"]["truncated"])

    def test_04_max_time_window_rejection(self):
        """4. Maximum time-window rejection: gap exceeds max_inter_hop_minutes."""
        txns = [
            {
                "_id": "TXN_01",
                "ts": "2026-09-20T10:00:00Z",
                "from": "ACC_A",
                "to": "ACC_B",
                "amount_paise": 100000,
            },
            {
                "_id": "TXN_02",
                "ts": "2026-09-20T12:00:00Z",  # 120 minutes later
                "from": "ACC_B",
                "to": "ACC_C",
                "amount_paise": 100000,
            },
        ]

        # Allow max 60 minutes
        result = analyze_temporal_fund_flows(txns, min_hops=2, max_inter_hop_minutes=60.0)
        self.assertEqual(result["summary"]["total_paths_identified"], 0)
        self.assertFalse(result["summary"]["truncated"])

        # Allow max 180 minutes
        result_ok = analyze_temporal_fund_flows(txns, min_hops=2, max_inter_hop_minutes=180.0)
        self.assertEqual(result_ok["summary"]["total_paths_identified"], 1)
        self.assertFalse(result_ok["summary"]["truncated"])

    def test_05_cycle_handling(self):
        """5. Cycle handling: A -> B -> A -> C must not produce infinite loops or duplicate nodes."""
        txns = [
            {
                "_id": "TXN_01",
                "ts": "2026-09-20T10:00:00Z",
                "from": "ACC_A",
                "to": "ACC_B",
                "amount_paise": 100000,
            },
            {
                "_id": "TXN_02",
                "ts": "2026-09-20T10:10:00Z",
                "from": "ACC_B",
                "to": "ACC_A",
                "amount_paise": 100000,
            },
            {
                "_id": "TXN_03",
                "ts": "2026-09-20T10:20:00Z",
                "from": "ACC_A",
                "to": "ACC_C",
                "amount_paise": 100000,
            },
        ]

        result = analyze_temporal_fund_flows(txns, min_hops=2, max_hops=5)
        self.assertFalse(result["summary"]["truncated"])
        # Should find valid acyclic segments: (A->B, B->A) and (B->A, A->C), but never (A->B->A->C)
        for p in result["paths"]:
            node_seq = [p["chain"][0]["from_account"]] + [hop["to_account"] for hop in p["chain"]]
            self.assertEqual(len(node_seq), len(set(node_seq)), "Paths must be simple/acyclic")

    def test_06_cash_termination(self):
        """6. CASH termination: CASH cannot forward funds downstream."""
        txns = [
            {
                "_id": "TXN_01",
                "ts": "2026-09-20T10:00:00Z",
                "from": "ACC_A",
                "to": "CASH",
                "amount_paise": 100000,
            },
            {
                "_id": "TXN_02",
                "ts": "2026-09-20T10:15:00Z",
                "from": "CASH",
                "to": "ACC_B",
                "amount_paise": 100000,
            },
        ]

        result = analyze_temporal_fund_flows(txns, min_hops=2)
        self.assertEqual(result["summary"]["total_paths_identified"], 0)
        self.assertFalse(result["summary"]["truncated"])

    def test_07_integer_paise_preservation(self):
        """7. Integer paise preservation: monetary values remain exact integers."""
        amt_in = 123456789
        amt_out = 98765432
        txns = [
            {
                "_id": "TXN_01",
                "ts": "2026-09-20T10:00:00Z",
                "from": "ACC_A",
                "to": "ACC_B",
                "amount_paise": amt_in,
            },
            {
                "_id": "TXN_02",
                "ts": "2026-09-20T10:10:00Z",
                "from": "ACC_B",
                "to": "ACC_C",
                "amount_paise": amt_out,
            },
        ]

        result = analyze_temporal_fund_flows(txns, min_hops=2)
        path = result["paths"][0]
        self.assertIsInstance(path["initial_amount_paise"], int)
        self.assertIsInstance(path["final_amount_paise"], int)
        self.assertEqual(path["initial_amount_paise"], amt_in)
        self.assertEqual(path["final_amount_paise"], amt_out)
        self.assertIsInstance(path["chain"][0]["amount_paise"], int)
        self.assertIsInstance(path["chain"][1]["amount_paise"], int)

    def test_08_multiple_paths_and_determinism(self):
        """8. Multiple paths with deterministic output ordering across repeat executions."""
        txns = [
            {"_id": "T1", "ts": "2026-09-20T10:00:00Z", "from": "A", "to": "B", "amount_paise": 100},
            {"_id": "T2", "ts": "2026-09-20T10:05:00Z", "from": "B", "to": "C", "amount_paise": 90},
            {"_id": "T3", "ts": "2026-09-20T10:10:00Z", "from": "C", "to": "D", "amount_paise": 80},
            {"_id": "T4", "ts": "2026-09-20T10:06:00Z", "from": "B", "to": "E", "amount_paise": 85},
            {"_id": "T5", "ts": "2026-09-20T10:12:00Z", "from": "E", "to": "D", "amount_paise": 75},
        ]

        res1 = analyze_temporal_fund_flows(txns, min_hops=2, max_hops=4)
        res2 = analyze_temporal_fund_flows(txns, min_hops=2, max_hops=4)

        self.assertEqual(res1, res2)
        self.assertGreater(res1["summary"]["total_paths_identified"], 1)
        self.assertFalse(res1["summary"]["truncated"])

    def test_09_empty_transaction_input(self):
        """9. Empty transaction input handles cleanly."""
        result = analyze_temporal_fund_flows([])
        self.assertEqual(result["summary"]["total_paths_identified"], 0)
        self.assertEqual(result["summary"]["avg_hop_latency_minutes"], 0.0)
        self.assertIsNone(result["summary"]["fastest_path_minutes"])
        self.assertFalse(result["summary"]["truncated"])
        self.assertEqual(result["paths"], [])

    def test_10_single_transaction_input(self):
        """10. Single transaction input behavior."""
        txns = [
            {"_id": "T1", "ts": "2026-09-20T10:00:00Z", "from": "A", "to": "B", "amount_paise": 100}
        ]
        # Default min_hops=2 -> 0 multi-hop paths
        result_default = analyze_temporal_fund_flows(txns, min_hops=2)
        self.assertEqual(result_default["summary"]["total_paths_identified"], 0)
        self.assertFalse(result_default["summary"]["truncated"])

        # Configured min_hops=1 -> 1 single-hop path
        result_1hop = analyze_temporal_fund_flows(txns, min_hops=1)
        self.assertEqual(result_1hop["summary"]["total_paths_identified"], 1)
        self.assertFalse(result_1hop["summary"]["truncated"])
        self.assertEqual(result_1hop["paths"][0]["hops"], 1)

    def test_11_max_hops_enforcement(self):
        """11. max_hops strictly bounds traversal depth."""
        txns = [
            {"_id": "T1", "ts": "2026-09-20T10:00:00Z", "from": "A", "to": "B", "amount_paise": 100},
            {"_id": "T2", "ts": "2026-09-20T10:05:00Z", "from": "B", "to": "C", "amount_paise": 100},
            {"_id": "T3", "ts": "2026-09-20T10:10:00Z", "from": "C", "to": "D", "amount_paise": 100},
            {"_id": "T4", "ts": "2026-09-20T10:15:00Z", "from": "D", "to": "E", "amount_paise": 100},
        ]

        result_2hops = analyze_temporal_fund_flows(txns, min_hops=2, max_hops=2)
        self.assertFalse(result_2hops["summary"]["truncated"])
        for p in result_2hops["paths"]:
            self.assertLessEqual(p["hops"], 2)

    def test_12_amount_decay_calculation(self):
        """12. Amount decay percentage calculation."""
        txns = [
            {"_id": "T1", "ts": "2026-09-20T10:00:00Z", "from": "A", "to": "B", "amount_paise": 100000},
            {"_id": "T2", "ts": "2026-09-20T10:05:00Z", "from": "B", "to": "C", "amount_paise": 75000},
        ]
        result = analyze_temporal_fund_flows(txns, min_hops=2)
        self.assertFalse(result["summary"]["truncated"])
        self.assertEqual(result["paths"][0]["amount_decay_pct"], 25.0)

    def test_13_truncation_not_reached(self):
        """13. Explicit verification of truncated == False when below max_paths."""
        txns = [
            {"_id": "T1", "ts": "2026-09-20T10:00:00Z", "from": "A", "to": "B", "amount_paise": 100},
            {"_id": "T2", "ts": "2026-09-20T10:05:00Z", "from": "B", "to": "C", "amount_paise": 100},
        ]
        result = analyze_temporal_fund_flows(txns, min_hops=2, max_paths=10)
        self.assertEqual(result["summary"]["total_paths_identified"], 1)
        self.assertFalse(result["summary"]["truncated"])

    def test_14_truncation_reached(self):
        """14. Explicit verification of truncated == True when max_paths cap is hit."""
        # Create a network with multiple branching paths
        txns = [
            {"_id": "T1", "ts": "2026-09-20T10:00:00Z", "from": "A", "to": "B", "amount_paise": 100},
            {"_id": "T2", "ts": "2026-09-20T10:05:00Z", "from": "B", "to": "C", "amount_paise": 100},
            {"_id": "T3", "ts": "2026-09-20T10:06:00Z", "from": "B", "to": "D", "amount_paise": 100},
            {"_id": "T4", "ts": "2026-09-20T10:07:00Z", "from": "B", "to": "E", "amount_paise": 100},
            {"_id": "T5", "ts": "2026-09-20T10:08:00Z", "from": "B", "to": "F", "amount_paise": 100},
        ]
        # Cap at 2 paths
        result = analyze_temporal_fund_flows(txns, min_hops=2, max_paths=2)
        self.assertEqual(result["summary"]["total_paths_identified"], 2)
        self.assertTrue(result["summary"]["truncated"])


if __name__ == "__main__":
    unittest.main()
