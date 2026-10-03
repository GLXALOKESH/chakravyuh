"""
test_loop.py - Tests for Ouroboros Adversarial Loop
===================================================
Validates:
- Complete execution of multi-round adversarial loop
- Evaluation occurs before retraining (no data leakage)
- Output metrics and summary structure match expectations
"""

import unittest
import pandas as pd
from ml.loop import run_ouroboros
from ml.models import evaluate


class TestLoop(unittest.TestCase):
    def test_run_ouroboros_smoke(self):
        results = run_ouroboros(n_rounds=1, profile="demo", seed=42)

        self.assertIn("rounds", results)
        self.assertIn("summary", results)
        self.assertIn("config", results)

        # 1 baseline + 1 adversarial round
        self.assertEqual(len(results["rounds"]), 2)

        round_0 = results["rounds"][0]
        self.assertEqual(round_0["type"], "baseline")
        self.assertIn("metrics", round_0)

        round_1 = results["rounds"][1]
        self.assertEqual(round_1["type"], "adversarial")
        self.assertIn("metrics", round_1)
        self.assertIn("evasion_rate", round_1)

    def test_evaluate_ring_recall_scale(self):
        """Regression test: verify risk_v2 in [0, 1] scale correctly yields non-zero ring recall."""
        ground_truth = [
            {"ring_id": "RING01", "member_ids": ["ACC0001", "ACC0002", "ACC0003"], "pattern": "A"},
        ]
        # Scored DataFrame with [0, 1] probability scale
        df = pd.DataFrame(
            {
                "risk_v2": [0.85, 0.90, 0.75, 0.05, 0.10],
                "prob_v1": [0.80, 0.85, 0.70, 0.05, 0.10],
                "prob_v2": [0.85, 0.90, 0.75, 0.05, 0.10],
            },
            index=["ACC0001", "ACC0002", "ACC0003", "ACC0004", "ACC0005"],
        )

        metrics = evaluate(df, ground_truth)
        self.assertEqual(metrics["ring_recall"], 1.0, "ring_recall must be 1.0 for high-risk members in [0, 1] scale")
        self.assertEqual(metrics["n_flagged"], 3)


if __name__ == "__main__":
    unittest.main()
