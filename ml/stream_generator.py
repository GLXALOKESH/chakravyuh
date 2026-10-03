"""
stream_generator.py  —  Chakravyuh live synthetic data
=======================================================
Plays a synthetic bank forward in time and writes what happens as it
happens, one JSON object per line (NDJSON), to stdout. The server starts
this as a child process for each live run and reads the lines; nothing is
written to disk.

    python ml/stream_generator.py                 # a fresh random run
    python ml/stream_generator.py --fixed         # seed 42, for rehearsals
    python ml/stream_generator.py --seed 918273 --rate 900 --accounts 3000
    python ml/stream_generator.py --fast --duration-min 2880 | head

Everything is built from the batch generator's own parts (generate.py):
make_accounts and assign_normal_identifiers for the population, and the
plant_a/b/c/d planters for the fraud rings. Each ring's cascade is planted
at a random moment of the run and shifted to start there. Normal traffic is
a Poisson stream at the `train` profile's density (about 0.28 transactions
per account per simulated day), so the live model sees the kind of activity
it was trained on.

Labels stay out of band. Every `txn` line carries a `gt` object
(is_fraud, ring) and each planted ring gets a `truth` line; the server uses
those only to score the predictor, and never passes them on.

Line types, in non-decreasing simulated time:
    run, account, identifier, txn, truth, clock, end
"""

from __future__ import annotations

import argparse
import heapq
import json
import math
import random
import secrets
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ML_DIR = Path(__file__).resolve().parent
if str(ML_DIR) not in sys.path:
    sys.path.insert(0, str(ML_DIR))

from generate import (  # noqa: E402
    CASH,
    FORWARDER_SHARE,
    INDIAN_CITIES,
    MERCHANT_SHARE,
    RING_FNS,
    assign_normal_identifiers,
    did,
    fmt_ts,
    iid,
    jitter,
    make_accounts,
    parse_ts,
    pid,
    plan_merchant_burst,
    plan_quick_forward,
    tid,
)

# Normal transactions per account per simulated day in the `train` profile
# (50,000 over 6,000 accounts and 30 days).
TRAIN_DENSITY = 50_000 / 6_000 / 30
SALARY_WINDOW_S = 600


class Emitter:
    """Writes NDJSON lines; a closed pipe means the server has gone, so the run ends."""

    def __init__(self, out):
        self.out = out
        self.lines = 0

    def __call__(self, obj: dict):
        self.out.write(json.dumps(obj, separators=(",", ":")) + "\n")
        self.lines += 1

    def flush(self):
        self.out.flush()


class LiveBank:
    def __init__(self, seed: int, n_accounts: int, sim_start: datetime, patterns: list[str],
                 first_ring_min: float, ring_every_min: float, density: float):
        self.seed = seed
        self.rng = random.Random(seed)
        self.sim_start = sim_start
        self.patterns = patterns
        self.first_ring_s = first_ring_min * 60
        self.ring_every_s = ring_every_min * 60
        self.rate_per_s = n_accounts * density / 86400
        # Honest look-alike episodes (generate.py 6b), at the batch generator's rate.
        self.lookalike_per_s = n_accounts * (FORWARDER_SHARE + MERCHANT_SHARE) / (30 * 86400)
        self.ctr = [0]
        self.heap: list = []
        self.order = 0
        self.ring_count = 0
        self.n_accounts = n_accounts

        self.accounts = make_accounts(n_accounts, self.rng, sim_start)
        self.by_id = {a["_id"]: a for a in self.accounts}
        self.all_ids = [a["_id"] for a in self.accounts]
        self.balances = {a["_id"]: a["opening_balance"] for a in self.accounts}
        # Money set aside for a ring's cascade, which everyday spending leaves alone.
        self.reserved: dict[str, int] = {}
        self.pools = {
            "device": max(50, n_accounts // 5),
            "phone": max(50, n_accounts // 5),
            "ip": max(30, n_accounts // 8),
        }
        self.identifiers = assign_normal_identifiers(
            self.accounts, self.rng, self.pools["device"], self.pools["phone"], self.pools["ip"], share_rate=0.04,
        )

    # ---- scheduling ----------------------------------------------------

    def push(self, ts: datetime, kind: str, payload=None):
        self.order += 1
        heapq.heappush(self.heap, (ts.timestamp(), self.order, kind, payload))

    def opening(self, emit: Emitter):
        """The population, their identifiers and their salaries, then the first of everything else."""
        for a in self.accounts:
            emit(account_line(a))
        for rec in self.identifiers:
            for aid in rec["account_ids"]:
                emit({"type": "identifier", "id": rec["_id"], "kind": rec["type"], "account_id": aid})
        # Salaries land in the first ten minutes, as in the batch generator.
        for a in self.accounts:
            for _ in range(self.rng.randint(1, 2)):
                amount = self.rng.randint(20_000, 200_000) * 100
                ts = self.sim_start + timedelta(seconds=self.rng.randint(0, SALARY_WINDOW_S))
                self.push(ts, "txn", ({"from": "SALARY", "to": a["_id"], "amount_paise": amount,
                                       "channel": self.rng.choice(["NEFT", "IMPS"]), "location": None}, None))
        self.push(self.sim_start + timedelta(seconds=SALARY_WINDOW_S + self.rng.expovariate(self.rate_per_s)), "normal")
        self.push(self.sim_start + timedelta(seconds=self.first_ring_s), "ring")
        self.push(self.sim_start + timedelta(seconds=SALARY_WINDOW_S + self.rng.expovariate(self.lookalike_per_s)), "lookalike")

    # ---- normal traffic ----------------------------------------------------

    def sample_normal(self) -> dict | None:
        """One ordinary transfer, ATM withdrawal or payment, drawn against live balances."""
        rng = self.rng
        for _ in range(30):
            frm = rng.choice(self.all_ids)
            bal = self.balances.get(frm, 0) - self.reserved.get(frm, 0)
            if bal < 10_000:
                continue
            kind = rng.choices(["p2p", "merchant", "atm"], weights=[0.40, 0.45, 0.15])[0]
            if kind == "atm":
                max_amt = min(bal, 20_000 * 100)
                if max_amt < 50_000:
                    continue
                amount = rng.randint(100, max_amt // 100) * 100
                home = self.by_id[frm]["home"]
                city = rng.choice(INDIAN_CITIES) if rng.random() < 0.10 else home
                lat, lng = jitter(city["lat"], city["lng"], rng)
                return {"from": frm, "to": CASH, "amount_paise": amount, "channel": "ATM",
                        "location": {"city": city["city"], "lat": lat, "lng": lng}}
            to = rng.choice(self.all_ids)
            if to == frm:
                continue
            max_amt = min(bal, (50_000 if kind == "p2p" else 10_000) * 100)
            if max_amt < 10_000:
                continue
            amount = rng.randint(50, max_amt // 100) * 100
            channel = rng.choice(["UPI", "IMPS", "NEFT"] if kind == "p2p" else ["UPI"])
            return {"from": frm, "to": to, "amount_paise": amount, "channel": channel, "location": None}
        return None

    # ---- rings -------------------------------------------------------------

    def plant(self, at: datetime, emit: Emitter):
        """
        Plants the next ring. Its accounts appear now and live ordinary lives
        (a salary, everyday transfers) for 3 to 8 simulated hours before the
        victim's money arrives, as recruited mules do; an account that only
        ever existed for its cascade would be trivially easy to spot.
        """
        pattern = self.patterns[self.ring_count % len(self.patterns)]
        self.ring_count += 1
        label = f"G{self.ring_count:02d}"
        offset = self.n_accounts + 100 + (self.ring_count - 1) * 30
        scratch_ids: list = []
        scratch_bal: dict = {}
        ring_accs, txns, gt, member_ids, victim_old = RING_FNS[pattern](
            label, self.rng, self.sim_start, self.ctr, scratch_bal, scratch_ids, offset)

        victim_txn = next(t for t in txns if t["_id"] == victim_old)
        # The planters name the victim after the ring (VICTIM_G01), which would
        # hand the ring's label to the predictor and the dashboard. A neutral
        # id keeps the VICTIM_ prefix that marks an external account.
        victim_txn["from"] = f"VICTIM_{self.rng.getrandbits(32):08X}"
        victim_ts = parse_ts(victim_txn["ts"])
        deposit_at = at + timedelta(hours=self.rng.uniform(3, 8))
        shift = deposit_at - victim_ts
        for t in txns:
            t["ts"] = fmt_ts(parse_ts(t["ts"]) + shift)
        # Opened as long before they first appear as before the batch
        # generator's window opens, so an account is the same age at its first
        # activity as in the training data (the planters open them 0-5 days
        # before `start_dt`).
        for a in ring_accs:
            a["opened_at"] = fmt_ts(parse_ts(a["opened_at"]) + (at - self.sim_start))

        # The planters size each hop from balances they track in planting
        # order, so in time order an account can briefly owe more than it
        # holds. The batch generator repairs that afterwards by raising the
        # opening balance; done here, before anything is sent, it is the same fix.
        txns.sort(key=lambda t: t["ts"])
        bal = {a["_id"]: a["opening_balance"] for a in ring_accs}
        worst: dict[str, int] = {}
        for t in txns:
            for side, sign in ((t["from"], -1), (t["to"], 1)):
                if side in bal:
                    bal[side] += sign * t["amount_paise"]
                    worst[side] = min(worst.get(side, 0), bal[side])
        for a in ring_accs:
            if worst.get(a["_id"], 0) < 0:
                a["opening_balance"] += -worst[a["_id"]] + 100

        for a in ring_accs:
            self.balances[a["_id"]] = a["opening_balance"]
            # Kept for the cascade: everyday spending may only use what is above it.
            self.reserved[a["_id"]] = a["opening_balance"]
            self.accounts.append(a)
            self.by_id[a["_id"]] = a
            self.all_ids.append(a["_id"])
            emit(account_line(a))
            for _ in range(self.rng.randint(1, 2)):
                salary = self.rng.randint(20_000, 200_000) * 100
                self.push(at + timedelta(seconds=self.rng.randint(0, SALARY_WINDOW_S)), "txn",
                          ({"from": "SALARY", "to": a["_id"], "amount_paise": salary,
                            "channel": self.rng.choice(["NEFT", "IMPS"]), "location": None}, None))
            # Like every other account, a ring member has an everyday device,
            # phone and IP from the shared pools (generate.py step 4).
            for kind, fmt in (("device", did), ("phone", pid), ("ip", iid)):
                emit({"type": "identifier", "id": fmt(self.rng.randrange(self.pools[kind])), "kind": kind, "account_id": a["_id"]})
        for rec in scratch_ids:
            for aid in rec["account_ids"]:
                emit({"type": "identifier", "id": rec["_id"], "kind": rec["type"], "account_id": aid})
        emit({"type": "truth", "ring": label, "pattern": pattern, "member_ids": member_ids,
              "victim_txn_id": victim_old, "victim_amount_paise": gt["victim_amount_paise"], "planted_at": fmt_ts(deposit_at)})
        for t in txns:
            body = {k: t[k] for k in ("from", "to", "amount_paise", "channel", "location")}
            body["id"] = t["_id"]
            self.push(parse_ts(t["ts"]), "txn", (body, label))

        gap = self.ring_every_s * self.rng.uniform(0.6, 1.4)
        self.push(at + timedelta(seconds=gap), "ring")

    # ---- the loop ----------------------------------------------------------

    def step(self, until: datetime, emit: Emitter):
        """Sends everything due up to `until`."""
        limit = until.timestamp()
        while self.heap and self.heap[0][0] <= limit:
            when, _, kind, payload = heapq.heappop(self.heap)
            at = datetime.fromtimestamp(when, tz=timezone.utc)
            if kind == "normal":
                body = self.sample_normal()
                if body:
                    self.send(at, body, None, emit)
                self.push(at + timedelta(seconds=self.rng.expovariate(self.rate_per_s)), "normal")
            elif kind == "ring":
                self.plant(at, emit)
            elif kind == "lookalike":
                acc = self.rng.choice(self.all_ids)
                share = FORWARDER_SHARE / (FORWARDER_SHARE + MERCHANT_SHARE)
                plan = (plan_quick_forward(acc, self.all_ids, self.balances, self.rng, at) if self.rng.random() < share
                        else plan_merchant_burst(acc, self.all_ids, self.balances, self.rng, at, self.by_id[acc]["home"]))
                for ts, body in plan:
                    self.push(ts, "txn", (body, None))
                self.push(at + timedelta(seconds=self.rng.expovariate(self.lookalike_per_s)), "lookalike")
            else:
                body, ring = payload
                self.send(at, body, ring, emit)

    def send(self, at: datetime, body: dict, ring: str | None, emit: Emitter):
        frm, to, amount = body["from"], body["to"], body["amount_paise"]
        # A planned transfer the account can no longer cover (other spending got
        # there first) is not made, as a bank would decline it. Ring balances
        # were repaired when planted, and salary and victims are external.
        if ring is None and frm in self.by_id and self.balances.get(frm, 0) - self.reserved.get(frm, 0) < amount:
            return
        if "id" not in body:
            body = {**body, "id": tid(self.ctr[0])}
            self.ctr[0] += 1
        self.balances[frm] = self.balances.get(frm, 0) - amount
        self.balances[to] = self.balances.get(to, 0) + amount
        emit({"type": "txn",
              "txn": {"id": body["id"], "from": frm, "to": to, "amount_paise": amount, "ts": fmt_ts(at),
                      "channel": body["channel"], "location": body.get("location")},
              "gt": {"is_fraud": ring is not None, "ring": ring}})


def account_line(a: dict) -> dict:
    """An account as the server receives it: no ring, role or label fields."""
    return {"type": "account", "account": {
        "id": a["_id"], "holder": a["holder"], "bank": a["bank"], "home": a["home"],
        "opened_at": a["opened_at"], "opening_balance_paise": a["opening_balance"]}}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Chakravyuh live synthetic data (NDJSON on stdout)")
    seed = ap.add_mutually_exclusive_group()
    seed.add_argument("--seed", type=int, help="seed for this run (default: a new random one)")
    seed.add_argument("--fixed", action="store_true", help="use seed 42, for rehearsals")
    ap.add_argument("--rate", type=float, default=300, help="simulated seconds per real second")
    ap.add_argument("--accounts", type=int, default=3000)
    ap.add_argument("--density", type=float, default=TRAIN_DENSITY, help="normal transactions per account per simulated day")
    ap.add_argument("--first-ring-min", type=float, default=30, help="simulated minutes before the first ring's accounts appear")
    ap.add_argument("--ring-every-min", type=float, default=480, help="simulated minutes between rings, on average")
    ap.add_argument("--patterns", default="A,B,C,D")
    ap.add_argument("--duration-min", type=float, default=14 * 24 * 60, help="simulated minutes the run lasts")
    ap.add_argument("--start", help="simulated start, YYYY-MM-DDTHH:MM:SSZ (default: this hour)")
    ap.add_argument("--fast", action="store_true", help="no pacing: run as fast as possible (tests)")
    args = ap.parse_args(argv)

    run_seed = 42 if args.fixed else args.seed if args.seed is not None else secrets.randbits(32)
    start = parse_ts(args.start) if args.start else datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    patterns = [p.strip().upper() for p in args.patterns.split(",") if p.strip().upper() in RING_FNS] or ["A", "B", "C"]
    bank = LiveBank(run_seed, args.accounts, start, patterns, args.first_ring_min, args.ring_every_min, args.density)
    end = start + timedelta(minutes=args.duration_min)
    emit = Emitter(sys.stdout)

    try:
        emit({"type": "run", "seed": run_seed, "rate": args.rate, "sim_start": fmt_ts(start), "sim_end": fmt_ts(end),
              "config": {"accounts": args.accounts, "patterns": patterns, "density": round(args.density, 4),
                         "first_ring_min": args.first_ring_min, "ring_every_min": args.ring_every_min}})
        bank.opening(emit)
        emit.flush()

        if args.fast:
            sim = start
            while sim < end:
                sim = min(end, sim + timedelta(seconds=300))
                bank.step(sim, emit)
                emit({"type": "clock", "ts": fmt_ts(sim)})
        else:
            wall0 = time.monotonic()
            next_clock = 0.0
            while True:
                elapsed = time.monotonic() - wall0
                sim = min(end, start + timedelta(seconds=elapsed * args.rate))
                bank.step(sim, emit)
                if elapsed >= next_clock or sim >= end:
                    emit({"type": "clock", "ts": fmt_ts(sim)})
                    next_clock = math.floor(elapsed) + 1.0
                emit.flush()
                if sim >= end:
                    break
                time.sleep(0.05)
        emit({"type": "end", "reason": "duration"})
        emit.flush()
    except (BrokenPipeError, KeyboardInterrupt):
        # The reader went away: the run was stopped.
        try:
            sys.stdout.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
