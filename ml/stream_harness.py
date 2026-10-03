"""
stream_harness.py  —  the live generator straight into the live predictor
==========================================================================
For working on the ML side without the server: runs stream_generator in
fast mode, hands its lines to OnlineScorer in the same batches the server
would send (one per `clock` line), and reports what was caught and how soon.

    python ml/stream_harness.py --fixed --days 3
    python ml/stream_harness.py --seed 7 --days 5 --quiet

Labels (`gt`, `truth`) are kept here for scoring only, exactly as the
server does; the scorer never sees them.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import time
from contextlib import redirect_stdout
from pathlib import Path

ML_DIR = Path(__file__).resolve().parent
if str(ML_DIR) not in sys.path:
    sys.path.insert(0, str(ML_DIR))

from online import OnlineScorer, parse_ts  # noqa: E402
from stream_generator import main as generate  # noqa: E402


def run(seed_args: list[str], days: float, quiet: bool) -> dict:
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        generate([*seed_args, "--fast", "--duration-min", str(days * 1440)])
    lines = [json.loads(line) for line in buffer.getvalue().splitlines()]

    scorer = OnlineScorer()
    began = time.perf_counter()
    scorer.warm()
    warm_s = time.perf_counter() - began
    run_line = lines[0]
    scorer.reset("harness", run_line["sim_start"])

    truth: dict[str, dict] = {}
    batch = {"accounts": [], "identifiers": [], "txns": []}
    seq = 0
    fired: dict[str, str] = {}
    slowest = 0.0
    for line in lines:
        kind = line["type"]
        if kind == "account":
            batch["accounts"].append(line["account"])
        elif kind == "identifier":
            batch["identifiers"].append({k: line[k] for k in ("id", "kind", "account_id")})
        elif kind == "txn":
            batch["txns"].append(line["txn"])
        elif kind == "truth":
            truth[line["ring"]] = line
        elif kind == "clock":
            seq += 1
            response = scorer.predict({"run_id": "harness", "seq": seq, "clock": line["ts"], **batch})
            slowest = max(slowest, response["took_ms"])
            batch = {"accounts": [], "identifiers": [], "txns": []}
            for alert in response["alerts"]:
                fired[alert["ring_id"]] = alert["fired_at"]
                if not quiet:
                    ring = next(r for r in response["rings"] if r["id"] == alert["ring_id"])
                    print(f"  {alert['fired_at']}  {alert['ring_id']}  {len(ring['member_ids'])} accounts at the alert")
                    print(f"      {alert['reason']}")

    # Judge each ring by what it grew into, not by its first sighting: a ring
    # is alerted on as soon as part of it is visible and keeps gaining members.
    caught: dict[str, dict] = {}
    live = {rid: set(entry["members"]) for rid, entry in scorer.registry.rings.items()}
    # Only rings whose victim deposit happened before the run ended count.
    end = lines[-2]["ts"] if lines[-2]["type"] == "clock" else run_line["sim_end"]
    truth = {label: t for label, t in truth.items() if t["planted_at"] <= end}
    for label, t in truth.items():
        planted_members = set(t["member_ids"])
        best = max(live, key=lambda rid: len(live[rid] & planted_members) / len(live[rid] | planted_members), default=None)
        if best is None:
            continue
        jaccard = len(live[best] & planted_members) / len(live[best] | planted_members)
        if jaccard >= 0.5:
            minutes = (parse_ts(fired[best]) - parse_ts(t["planted_at"])).total_seconds() / 60
            caught[label] = {"ring": best, "minutes": round(minutes, 1), "jaccard": round(jaccard, 2)}
    if not quiet:
        for label, c in sorted(caught.items()):
            print(f"  {label} ({truth[label]['pattern']}) -> {c['ring']}: jaccard {c['jaccard']}, alerted {c['minutes']:.0f} min after the victim deposit")

    planted = len(truth)
    found = len(caught)
    matched = {c["ring"] for c in caught.values()}
    report = {
        "seed": run_line["seed"],
        "simulated_days": days,
        "planted": planted,
        "caught": found,
        "recall": round(found / planted, 3) if planted else None,
        "live_rings": len(scorer.registry.rings),
        "false_rings": len(set(live) - matched),
        "median_minutes_to_alert": sorted(c["minutes"] for c in caught.values())[found // 2] if found else None,
        "slowest_batch_ms": slowest,
        "model_warmup_s": round(warm_s, 1),
        "model_source": scorer.model_source,
        "batches": seq,
        "txns": len(scorer.txns),
    }
    missed = sorted(set(truth) - set(caught))
    if missed:
        report["missed"] = [f"{m} ({truth[m]['pattern']})" for m in missed]
    return report


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--seed", type=int)
    g.add_argument("--fixed", action="store_true")
    ap.add_argument("--days", type=float, default=3)
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    seed_args = ["--fixed"] if a.fixed else ["--seed", str(a.seed)] if a.seed is not None else []
    print(json.dumps(run(seed_args, a.days, a.quiet), indent=2))
