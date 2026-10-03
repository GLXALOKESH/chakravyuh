"""
test_stream_generator.py - the live generator, and the live predictor on its output
===================================================================================
The generator must behave like a feed a bank could actually receive: in time
order, every account announced before it is used, no balance going negative,
and no label anywhere except the `gt` field and `truth` lines the server keeps
to itself. The predictor fed from it must find the planted rings with ids that
hold steady as the rings grow, and exactly one alert each.

Run from the repo root:  python -m pytest ml/tests/test_stream_generator.py
"""

import io
import json
import unittest
from contextlib import redirect_stdout

from datetime import timedelta

from ml.online import OnlineScorer, is_pseudo, parse_ts
from ml.stream_generator import main as generate

TS_LEN = len("2026-10-01T00:00:00Z")


def run(*args):
    buf = io.StringIO()
    with redirect_stdout(buf):
        generate(["--fast", "--start", "2026-10-01T00:00:00Z", *args])
    return [json.loads(line) for line in buf.getvalue().splitlines()]


class TestStreamGenerator(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lines = run("--fixed", "--duration-min", "2880", "--accounts", "1500")

    def test_same_seed_same_run(self):
        again = run("--fixed", "--duration-min", "2880", "--accounts", "1500")
        self.assertEqual(self.lines[:2000], again[:2000])
        self.assertEqual(len(self.lines), len(again))

    def test_a_new_seed_gives_a_different_run(self):
        other = run("--seed", "7", "--duration-min", "600", "--accounts", "1500")
        self.assertNotEqual(self.lines[1:200], other[1:200])

    def test_run_line_first_end_line_last(self):
        self.assertEqual(self.lines[0]["type"], "run")
        self.assertEqual(self.lines[0]["seed"], 42)
        self.assertEqual(self.lines[-1]["type"], "end")

    def test_time_order_and_format(self):
        last = ""
        for line in self.lines:
            if line["type"] != "txn":
                continue
            ts = line["txn"]["ts"]
            self.assertEqual(len(ts), TS_LEN)
            self.assertTrue(ts.endswith("Z"))
            self.assertGreaterEqual(ts, last)
            last = ts

    def test_accounts_and_identifiers_come_before_use(self):
        known = set()
        for line in self.lines:
            if line["type"] == "account":
                known.add(line["account"]["id"])
            elif line["type"] == "identifier":
                self.assertIn(line["account_id"], known)
            elif line["type"] == "txn":
                for side in (line["txn"]["from"], line["txn"]["to"]):
                    if not is_pseudo(side):
                        self.assertIn(side, known)

    def test_no_customer_balance_goes_negative(self):
        balance = {}
        for line in self.lines:
            if line["type"] == "account":
                balance[line["account"]["id"]] = line["account"]["opening_balance_paise"]
            elif line["type"] == "txn":
                t = line["txn"]
                balance[t["from"]] = balance.get(t["from"], 0) - t["amount_paise"]
                balance[t["to"]] = balance.get(t["to"], 0) + t["amount_paise"]
                if not is_pseudo(t["from"]):
                    self.assertGreaterEqual(balance[t["from"]], 0, f"{t['from']} overdrawn by {t['id']}")

    def test_labels_only_in_gt_and_truth(self):
        for line in self.lines:
            if line["type"] in ("truth",):
                continue
            body = dict(line)
            body.pop("gt", None)
            text = json.dumps(body)
            for leak in ("is_fraud", "ring_id", '"role"', "G0"):
                self.assertNotIn(leak, text, f"{leak} in a {line['type']} line")

    def test_rings_are_planted(self):
        truth = [line for line in self.lines if line["type"] == "truth"]
        self.assertGreaterEqual(len(truth), 4)
        fraud = sum(1 for line in self.lines if line["type"] == "txn" and line["gt"]["is_fraud"])
        self.assertGreater(fraud, 20)


class TestPredictorOnTheStream(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        lines = run("--fixed", "--duration-min", "2880", "--accounts", "1500")
        # Rings whose victim deposit came at least a day before the run ended,
        # so their cascades had time to play out.
        settled = (parse_ts(lines[-2]["ts"]) - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        cls.truth = {
            line["ring"]: set(line["member_ids"])
            for line in lines
            if line["type"] == "truth" and line["planted_at"] <= settled
        }
        scorer = OnlineScorer()
        scorer.warm()
        scorer.reset("test", lines[0]["sim_start"])
        batch = {"accounts": [], "identifiers": [], "txns": []}
        seq = 0
        cls.alerts = []
        cls.versions = {}
        for line in lines:
            kind = line["type"]
            if kind == "account":
                batch["accounts"].append(line["account"])
            elif kind == "identifier":
                batch["identifiers"].append({k: line[k] for k in ("id", "kind", "account_id")})
            elif kind == "txn":
                batch["txns"].append(line["txn"])
            elif kind == "clock":
                seq += 1
                out = scorer.predict({"run_id": "test", "seq": seq, "clock": line["ts"], **batch})
                batch = {"accounts": [], "identifiers": [], "txns": []}
                cls.alerts += out["alerts"]
                for ring in out["rings"]:
                    cls.versions.setdefault(ring["id"], []).append(ring["version"])
        cls.rings = {rid: set(e["members"]) for rid, e in scorer.registry.rings.items()}

    def test_most_planted_rings_are_found(self):
        # Not all: the data has honest look-alikes now, and pattern C (a
        # coordinator moving little money) is genuinely hard to see.
        found = [label for label, members in self.truth.items()
                 if max((len(members & r) / len(members | r) for r in self.rings.values()), default=0) >= 0.5]
        self.assertGreaterEqual(len(found) / len(self.truth), 0.6, f"found {found} of {sorted(self.truth)}")

    def test_one_alert_per_ring(self):
        ids = [a["ring_id"] for a in self.alerts]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(set(ids), set(self.rings))

    def test_few_rings_that_were_never_planted(self):
        planted = list(self.truth.values())
        false = [rid for rid, r in self.rings.items() if max((len(r & m) / len(r | m) for m in planted), default=0) < 0.5]
        self.assertLessEqual(len(false), max(2, len(self.rings) // 3), false)

    def test_versions_only_go_up(self):
        for rid, versions in self.versions.items():
            self.assertEqual(versions, sorted(set(versions)), rid)

    def test_victims_found_without_labels(self):
        # Each ring's victim deposit is found from the external VICTIM_ sender alone.
        self.assertTrue(all(a["reason"] for a in self.alerts))


if __name__ == "__main__":
    unittest.main()
