"""
test_online_parity.py - the live predictor's features match the batch ones
==========================================================================
Feeds the demo ledger to OnlineScorer in time order, a batch at a time, the
way the server will, and compares its per-account features with
features.compute_features on the same data. Any drift here would mean the
live dashboard scores accounts differently from the model's training data.

Run from the repo root:  python -m pytest ml/tests/test_online_parity.py
"""

import contextlib
import io
import json
import unittest

from ml.config import ML_DIR
from ml.features import V1_FEATURES, compute_features
from ml.online import OnlineScorer, is_pseudo

IDENTITY = ["shared_device_n", "shared_phone_n", "shared_ip_n", "shared_any_new_n"]


def load(name):
    with open(ML_DIR / "data" / "demo" / name, "r", encoding="utf-8") as f:
        return json.load(f)


class TestOnlineParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.accounts = load("accounts.json")
        cls.identifiers = load("identifiers.json")
        cls.txns = sorted(load("transactions.json"), key=lambda t: t["ts"])
        with contextlib.redirect_stdout(io.StringIO()):
            cls.batch = compute_features(cls.accounts, cls.txns, cls.identifiers)

        scorer = OnlineScorer()
        scorer._clear("parity", None)
        scorer._apply(
            [{"id": a["_id"], "opened_at": a["opened_at"], "opening_balance_paise": a["opening_balance"]} for a in cls.accounts],
            [{"id": r["_id"], "kind": r["type"], "account_id": a} for r in cls.identifiers for a in r["account_ids"]],
            [],
        )
        for i in range(0, len(cls.txns), 200):
            batch = [
                {k: t[k] for k in ("from", "to", "amount_paise", "ts", "channel")} | {"id": t["_id"], "location": t.get("location")}
                for t in cls.txns[i : i + 200]
            ]
            scorer._apply([], [], batch)
        cls.online = scorer.features_for(list(scorer.state))

    def test_every_active_account_is_scored(self):
        active = {a for t in self.txns for a in (t["from"], t["to"]) if not is_pseudo(a)}
        self.assertEqual(active, set(self.online.index))

    def test_transaction_features_match(self):
        for col in V1_FEATURES:
            if col == "median_hold_min":
                continue
            with self.subTest(col=col):
                diff = (self.online[col] - self.batch.loc[self.online.index, col]).abs()
                self.assertLessEqual(float(diff.max()), 1e-6, f"{col} differs on {list(diff[diff > 1e-6].index[:5])}")

    def test_hold_time_matches(self):
        # A credit and a debit with the same timestamp can pair either way, so
        # allow a handful of accounts to differ.
        diff = (self.online["median_hold_min"] - self.batch.loc[self.online.index, "median_hold_min"]).abs()
        off = diff[diff > 0.01]
        self.assertLessEqual(len(off), max(3, len(diff) // 200), f"hold time differs on {list(off.index[:10])}")

    def test_identity_features_match(self):
        for col in IDENTITY:
            with self.subTest(col=col):
                diff = (self.online[col] - self.batch.loc[self.online.index, col]).abs()
                self.assertEqual(float(diff.max()), 0.0, f"{col} differs on {list(diff[diff > 0].index[:5])}")


if __name__ == "__main__":
    unittest.main()
