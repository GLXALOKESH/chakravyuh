"""
taint.py  —  Chakravyuh Proportional Taint Tracing
=====================================================
Tracks tainted (fraudulent) funds through the transaction graph
using integer paise arithmetic.  No floating-point for monetary values.

Invariant:  sum(taint.values()) == victim_amount_paise  at all times.

Public API:
    trace(transactions, opening_balances, victim_txn_id, as_of=None)
        -> (balances, taint, flows)

    compute_default_taint(ring, transactions, accounts)
        -> dict  suitable for ring["default_taint"]

Reference: TRD §7.6
"""

from collections import defaultdict
from datetime import datetime, timezone


def _parse_ts(s):
    try:
        return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except Exception:
        return s   # return raw string if unparseable; comparisons still work


def trace(transactions, opening_balances, victim_txn_id, as_of=None):
    """
    Proportional taint tracing using INTEGER PAISE.

    Parameters:
        transactions       list of transaction dicts (must have amount_paise)
        opening_balances   dict  account_id -> int (paise)
        victim_txn_id      str   the transaction that introduces tainted money
        as_of              str   optional ISO timestamp cutoff

    Returns:
        bal    dict  account_id -> int  (current balance in paise)
        taint  dict  account_id -> int  (tainted paise held)
        flows  dict  (from, to)  -> int (tainted paise moved on this edge)

    Invariant: sum(taint.values()) == victim_amount_paise
    """
    bal   = dict(opening_balances)      # account -> integer paise
    taint = defaultdict(int)            # account -> integer tainted paise
    flows = defaultdict(int)            # (from, to) -> integer tainted paise

    started = False
    victim_amount = 0

    sorted_txns = sorted(transactions, key=lambda t: t["ts"])

    for t in sorted_txns:
        if as_of and t["ts"] > as_of:
            break

        u = t["from"]
        v = t["to"]
        x = t["amount_paise"]

        # Proportion of the sender's current balance that is tainted.
        if started and bal.get(u, 0) > 0 and taint[u] > 0:
            moved = (x * taint[u]) // bal[u]
        else:
            moved = 0

        # Update balances
        bal[u] = bal.get(u, 0) - x
        bal[v] = bal.get(v, 0) + x

        # Move taint
        if moved > 0:
            taint[u] -= moved
            taint[v] += moved
            flows[(u, v)] += moved

        # The victim transaction introduces exactly 100% tainted money.
        if t["_id"] == victim_txn_id:
            taint[v] += x
            victim_amount = x
            started = True

    return dict(bal), dict(taint), dict(flows), victim_amount


def compute_default_taint(ring, transactions, accounts):
    """
    Compute the default (full-timeline) taint for a ring.

    Returns a dict matching the TRD taint response shape:
        {
            "victim_amount": int,
            "accounts": [{"id", "balance", "tainted", "lien"}],
            "lost_to_cash": int,
            "links": [{"source", "target", "value"}],
        }
    """
    victim_txn_ids = ring.get("victim_txn_ids", [])
    if not victim_txn_ids:
        return {}

    victim_txn_id = victim_txn_ids[0]   # use first victim txn

    # Build opening balances
    opening_balances = {}
    for acc in accounts:
        opening_balances[acc["_id"]] = acc.get("opening_balance", 0)
    # Add pseudo-accounts
    opening_balances["SALARY"] = 10**15
    opening_balances["CASH"] = 0

    # Add VICTIM pseudo-accounts
    for t in transactions:
        if t["from"].startswith("VICTIM"):
            opening_balances.setdefault(t["from"], 10**15)

    bal, taint, flows, victim_amount = trace(
        transactions, opening_balances, victim_txn_id
    )

    if victim_amount == 0:
        return {}

    # Conservation check
    total_taint = sum(taint.values())
    if total_taint != victim_amount:
        print(f"  [taint] WARNING: conservation violated. "
              f"Expected {victim_amount}, got {total_taint} "
              f"(diff={total_taint - victim_amount})")

    # Build response
    member_set = set(ring.get("member_ids", []))
    taint_accounts = []
    for aid in sorted(taint.keys()):
        if taint[aid] <= 0:
            continue
        if aid == "CASH" or aid.startswith("VICTIM") or aid == "SALARY":
            continue
        balance = max(bal.get(aid, 0), 0)
        tainted = taint[aid]
        lien = min(tainted, balance)
        taint_accounts.append({
            "id": aid,
            "balance": balance,
            "tainted": tainted,
            "lien": lien,
        })

    lost_to_cash = taint.get("CASH", 0)

    links = []
    for (src, tgt), value in sorted(flows.items()):
        if value > 0:
            links.append({
                "source": src,
                "target": tgt,
                "value": value,
            })

    return {
        "victim_amount": victim_amount,
        "victim_txn_id": victim_txn_id,
        "accounts": taint_accounts,
        "lost_to_cash": lost_to_cash,
        "links": links,
    }
