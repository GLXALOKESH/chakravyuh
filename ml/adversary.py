"""
adversary.py  —  Red-Team Fraud Mutation Engine (Model 1)
==========================================================
Takes existing fraud patterns and generates increasingly difficult
variants designed to evade Model 2.

Mutation categories:
    1. Amount mutation   — Gaussian jitter on transaction amounts
    2. Temporal mutation — Poisson delay perturbation, preserves causality
    3. Multi-hop mutation — Insert intermediary accounts
    4. Topology mutation — Split flows, add routing nodes

Every adversarial sample retains metadata linking it to the original.

Public API:
    FraudAdversary.mutate_ring(ring_gt, transactions, accounts, identifiers, round_num)
        -> (new_accounts, new_transactions, new_identifiers, metadata)

Does NOT call features.py or models.py. Produces raw data only.
"""

import copy
import math
import random
import string
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np


# ─────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────

def _fmt_ts(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_ts(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def _rand_name(rng):
    first = rng.choice(["Aarav", "Vihaan", "Priya", "Diya", "Rohan", "Kiran",
                         "Sneha", "Meera", "Amit", "Pooja", "Harsh", "Yash"])
    last = rng.choice(["Sharma", "Gupta", "Singh", "Patel", "Kumar", "Mehta",
                        "Shah", "Verma", "Jain", "Reddy"])
    return f"{first} {rng.choice(string.ascii_uppercase)}. {last}"


BANKS = ["State Bank", "HDFC Bank", "ICICI Bank", "Axis Bank", "PNB",
         "Canara Bank", "Union Bank", "Kotak Bank"]

CITIES = [
    {"city": "Mumbai",    "lat": 19.076, "lng": 72.878},
    {"city": "Delhi",     "lat": 28.614, "lng": 77.209},
    {"city": "Bengaluru", "lat": 12.972, "lng": 77.595},
    {"city": "Kolkata",   "lat": 22.573, "lng": 88.364},
    {"city": "Chennai",   "lat": 13.083, "lng": 80.271},
]


# ─────────────────────────────────────────────────────────────────
# ADVERSARY CLASS
# ─────────────────────────────────────────────────────────────────

class FraudAdversary:
    """
    Adversarial generator that mutates existing fraud rings to produce
    harder-to-detect variants.
    """

    def __init__(self, random_state: int = 42):
        self.rng = random.Random(random_state)
        self.np_rng = np.random.default_rng(random_state)
        self.seed = random_state

        # Strategy weights (adapted based on detector feedback)
        self.strategy_weights = {
            "amount_jitter":     0.30,
            "temporal_delay":    0.30,
            "multi_hop":         0.20,
            "topology_split":    0.20,
        }

        # Mutation strength (increases with rounds)
        self.amount_sigma = 0.10      # σ as fraction of amount
        self.temporal_lambda = 15.0   # Poisson λ in minutes
        self.round_counter = 0
        self._id_counter = 0

    def _next_id(self, prefix="ADV"):
        self._id_counter += 1
        return f"{prefix}{self._id_counter:06d}"

    # ─────────────────────────────────────────────────────────
    # 1. AMOUNT MUTATION
    # ─────────────────────────────────────────────────────────

    def _mutate_amount(self, amount_paise: int) -> int:
        """
        Apply Gaussian jitter to an amount.
        - σ = self.amount_sigma * amount
        - Clamp to [1000, 2x original] (no negatives, no zero)
        - Round to nearest 100 paise (₹1)
        """
        sigma = self.amount_sigma * amount_paise
        jittered = self.np_rng.normal(amount_paise, sigma)
        jittered = max(1000, min(jittered, amount_paise * 2))
        return (int(jittered) // 100) * 100

    # ─────────────────────────────────────────────────────────
    # 2. TEMPORAL MUTATION
    # ─────────────────────────────────────────────────────────

    def _mutate_timestamp(self, ts_str: str, prev_ts_str: Optional[str] = None) -> str:
        """
        Add Poisson-distributed delay to a timestamp.
        - Preserves causality: result is always > prev_ts if provided.
        - Delay drawn from Poisson(λ) minutes.
        """
        ts = _parse_ts(ts_str)
        delay_min = self.np_rng.poisson(self.temporal_lambda)
        new_ts = ts + timedelta(minutes=int(delay_min))

        # Ensure causality
        if prev_ts_str:
            prev_ts = _parse_ts(prev_ts_str)
            if new_ts <= prev_ts:
                new_ts = prev_ts + timedelta(minutes=self.rng.randint(1, 5))

        return _fmt_ts(new_ts)

    # ─────────────────────────────────────────────────────────
    # 3. MULTI-HOP MUTATION
    # ─────────────────────────────────────────────────────────

    def _make_intermediary_account(self, start_dt: datetime) -> dict:
        """Create a valid intermediate account for multi-hop insertion."""
        acc_id = self._next_id("MADV")
        city = self.rng.choice(CITIES)
        return {
            "_id":             acc_id,
            "holder":          _rand_name(self.rng),
            "bank":            self.rng.choice(BANKS),
            "home":            dict(city),
            "opened_at":       _fmt_ts(start_dt - timedelta(days=self.rng.randint(1, 5))),
            "opening_balance": self.rng.randint(100, 5000) * 100,
            "features":        {},
            "risk_v1":         0.0,
            "risk_v2":         0.0,
            "signals":         [],
            "ring_id":         None,
            "role":            None,
            "role_reason":     None,
        }

    def _insert_multihop(self, txn: dict, start_dt: datetime) -> Tuple[list, list, list]:
        """
        Transform A→B into A→X→B by inserting an intermediary.

        Returns: (new_accounts, new_transactions, new_identifiers)
        """
        inter = self._make_intermediary_account(start_dt)
        orig_ts = _parse_ts(txn["ts"])
        amount = txn["amount_paise"]

        # A → X (slightly less, intermediary keeps a cut)
        cut = max(1000, (int(amount * self.rng.uniform(0.02, 0.08)) // 100) * 100)
        fwd_amount = amount - cut

        txn1 = {
            "_id":          self._next_id("TXNADV"),
            "from":         txn["from"],
            "to":           inter["_id"],
            "amount_paise": amount,
            "ts":           txn["ts"],
            "channel":      txn.get("channel", "UPI"),
            "location":     None,
            "is_fraud":     True,
        }

        txn2 = {
            "_id":          self._next_id("TXNADV"),
            "from":         inter["_id"],
            "to":           txn["to"],
            "amount_paise": fwd_amount,
            "ts":           _fmt_ts(orig_ts + timedelta(minutes=self.rng.randint(3, 20))),
            "channel":      self.rng.choice(["UPI", "IMPS"]),
            "location":     None,
            "is_fraud":     True,
        }

        # Shared device with sender (makes it look connected)
        new_id = {
            "_id":         self._next_id("DEVADV"),
            "type":        "device",
            "account_ids": [txn["from"], inter["_id"]],
        }

        return [inter], [txn1, txn2], [new_id]

    # ─────────────────────────────────────────────────────────
    # 4. TOPOLOGY MUTATION — FLOW SPLIT
    # ─────────────────────────────────────────────────────────

    def _split_flow(self, txn: dict, start_dt: datetime) -> Tuple[list, list, list]:
        """
        Split A→B(amount) into A→X(half) + A→Y(half), X→B + Y→B.
        Two new intermediaries absorb the same total flow.
        """
        x1 = self._make_intermediary_account(start_dt)
        x2 = self._make_intermediary_account(start_dt)
        orig_ts = _parse_ts(txn["ts"])
        amount = txn["amount_paise"]

        half1 = (amount // 2 // 100) * 100
        half2 = amount - half1

        cut1 = max(100, (int(half1 * 0.05) // 100) * 100)
        cut2 = max(100, (int(half2 * 0.05) // 100) * 100)

        txns = [
            {
                "_id": self._next_id("TXNADV"), "from": txn["from"], "to": x1["_id"],
                "amount_paise": half1, "ts": txn["ts"],
                "channel": "UPI", "location": None, "is_fraud": True,
            },
            {
                "_id": self._next_id("TXNADV"), "from": txn["from"], "to": x2["_id"],
                "amount_paise": half2,
                "ts": _fmt_ts(orig_ts + timedelta(minutes=self.rng.randint(1, 5))),
                "channel": "IMPS", "location": None, "is_fraud": True,
            },
            {
                "_id": self._next_id("TXNADV"), "from": x1["_id"], "to": txn["to"],
                "amount_paise": half1 - cut1,
                "ts": _fmt_ts(orig_ts + timedelta(minutes=self.rng.randint(10, 25))),
                "channel": "UPI", "location": None, "is_fraud": True,
            },
            {
                "_id": self._next_id("TXNADV"), "from": x2["_id"], "to": txn["to"],
                "amount_paise": half2 - cut2,
                "ts": _fmt_ts(orig_ts + timedelta(minutes=self.rng.randint(15, 30))),
                "channel": "IMPS", "location": None, "is_fraud": True,
            },
        ]

        return [x1, x2], txns, []

    # ─────────────────────────────────────────────────────────
    # MAIN MUTATION ENTRY POINT
    # ─────────────────────────────────────────────────────────

    def mutate_ring(self, ring_gt: dict, transactions: list,
                    accounts: list, identifiers: list,
                    round_num: int) -> Tuple[list, list, list, dict]:
        """
        Take a ground-truth ring and produce a mutated adversarial variant.

        Parameters:
            ring_gt        ground_truth entry for one ring
            transactions   full transaction list
            accounts       full account list
            identifiers    full identifier list
            round_num      current Ouroboros round

        Returns:
            (new_accounts, new_transactions, new_identifiers, metadata)
        """
        self.round_counter = round_num

        member_ids = set(ring_gt["member_ids"])
        ring_txns = [
            t for t in transactions
            if t.get("is_fraud") and
            (t["from"] in member_ids or t["to"] in member_ids)
        ]
        ring_txns.sort(key=lambda t: t["ts"])

        if not ring_txns:
            return [], [], [], {}

        # Decide which mutations to apply (weighted random selection)
        strategies = list(self.strategy_weights.keys())
        weights = [self.strategy_weights[s] for s in strategies]
        chosen = self.np_rng.choice(strategies, p=weights)

        # Also apply amount jitter to ALL transactions
        apply_amount = True
        apply_temporal = chosen == "temporal_delay" or self.rng.random() < 0.5
        apply_multihop = chosen == "multi_hop"
        apply_split = chosen == "topology_split"

        # Start building mutated data
        new_accounts = []
        new_transactions = []
        new_identifiers = []
        mutation_types = []

        # Copy ring accounts (deep copy)
        ring_accounts = [copy.deepcopy(a) for a in accounts if a["_id"] in member_ids]

        # Determine earliest ring timestamp for intermediary accounts
        start_dt = _parse_ts(ring_txns[0]["ts"]) if ring_txns else datetime.now(timezone.utc)

        prev_ts = None
        for txn in ring_txns:
            t = copy.deepcopy(txn)

            # Amount mutation (always applied)
            if apply_amount:
                t["amount_paise"] = self._mutate_amount(t["amount_paise"])

            # Temporal mutation
            if apply_temporal:
                t["ts"] = self._mutate_timestamp(t["ts"], prev_ts)

            prev_ts = t["ts"]

            # Structural mutations: multi-hop or split (on ~30% of transactions)
            if apply_multihop and self.rng.random() < 0.30 and t["to"] != "CASH":
                accs, txns, ids = self._insert_multihop(t, start_dt)
                new_accounts.extend(accs)
                new_transactions.extend(txns)
                new_identifiers.extend(ids)
                if "multi_hop" not in mutation_types:
                    mutation_types.append("multi_hop")
            elif apply_split and self.rng.random() < 0.25 and t["to"] != "CASH":
                accs, txns, ids = self._split_flow(t, start_dt)
                new_accounts.extend(accs)
                new_transactions.extend(txns)
                new_identifiers.extend(ids)
                if "topology_split" not in mutation_types:
                    mutation_types.append("topology_split")
            else:
                # Reassign a new ID to the mutated transaction
                t["_id"] = self._next_id("TXNADV")
                new_transactions.append(t)

        if apply_amount and "amount_jitter" not in mutation_types:
            mutation_types.append("amount_jitter")
        if apply_temporal and "temporal_delay" not in mutation_types:
            mutation_types.append("temporal_delay")

        # Sort by timestamp
        new_transactions.sort(key=lambda t: t["ts"])

        # Metadata for evaluation
        metadata = {
            "original_ring_id":     ring_gt["ring_id"],
            "original_pattern":     ring_gt.get("pattern", "unknown"),
            "mutation_types":       mutation_types,
            "mutation_parameters": {
                "amount_sigma":     self.amount_sigma,
                "temporal_lambda":  self.temporal_lambda,
            },
            "adversarial_round":    round_num,
            "random_seed":          self.seed,
            "n_original_txns":      len(ring_txns),
            "n_mutated_txns":       len(new_transactions),
            "n_new_accounts":       len(new_accounts),
            "original_member_ids":  ring_gt["member_ids"],
        }

        return new_accounts, new_transactions, new_identifiers, metadata

    def adapt_strategy(self, missed_ids: set, detected_ids: set,
                       mutation_types_used: list):
        """
        Evolve strategy weights based on detector performance.

        - If most adversarial samples were missed: boost those mutation types.
        - If most were detected: reduce weight and try other strategies.
        """
        if not missed_ids and not detected_ids:
            return

        total = len(missed_ids) + len(detected_ids)
        evasion_rate = len(missed_ids) / max(total, 1)

        # If evasion worked well, increase mutation strength
        if evasion_rate > 0.5:
            self.amount_sigma = min(self.amount_sigma * 1.2, 0.30)
            self.temporal_lambda = min(self.temporal_lambda * 1.3, 60.0)
        else:
            # Shift weights toward structural mutations
            self.strategy_weights["multi_hop"] = min(
                self.strategy_weights["multi_hop"] + 0.05, 0.40
            )
            self.strategy_weights["topology_split"] = min(
                self.strategy_weights["topology_split"] + 0.05, 0.40
            )
            # Normalise
            total_w = sum(self.strategy_weights.values())
            for k in self.strategy_weights:
                self.strategy_weights[k] /= total_w
