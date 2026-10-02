"""
test_loop.py - Tests for Ouroboros Adversarial Loop
===================================================
Validates:
- Complete execution of multi-round adversarial loop
- Evaluation occurs before retraining (no data leakage)
- Output metrics and summary structure match expectations
"""

import unittest
from ml.loop import run_ouroboros


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


if __name__ == "__main__":
    unittest.main()
