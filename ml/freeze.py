"""
freeze.py  —  Chakravyuh Freeze Optimiser
============================================
Identifies the minimal set of accounts to freeze to secure the most
tainted money, using brute-force min-cut for small rings (≤15 accounts)
and greedy selection for larger ones.

Public API:
    recommend_freeze(ring, transactions, accounts, victim_txn_id,
                     k=3, exclude=None, as_of=None)
        -> dict {freeze, at_risk_before, secured, pct_stopped}

Reference: TRD §7.7
"""

from collections import defaultdict
from itertools import combinations

import networkx as nx

try:
    from ml.taint import trace
except ImportError:
    from taint import trace


CASH = "CASH"


def _build_flow_graph(ring_member_ids, transactions, as_of=None):
    """
    Build a directed graph of observed channels within the ring,
    including edges to CASH.
    """
    G = nx.DiGraph()
    member_set = set(ring_member_ids)
    # Include CASH as a node
    relevant = member_set | {CASH}
    G.add_nodes_from(relevant)

    for t in transactions:
        if as_of and t["ts"] > as_of:
            continue
        frm, to = t["from"], t["to"]
        if frm in member_set and to in relevant:
            if G.has_edge(frm, to):
                G[frm][to]["weight"] += t["amount_paise"]
            else:
                G.add_edge(frm, to, weight=t["amount_paise"])

    return G


def _at_risk(taint_map, flow_graph, frozen=None):
    """
    At-risk amount = total tainted balance in accounts that still have
    a path to CASH in the flow graph (after removing frozen accounts).
    """
    if frozen is None:
        frozen = set()

    # Build subgraph without frozen accounts
    remaining = set(flow_graph.nodes()) - frozen
    subgraph = flow_graph.subgraph(remaining)

    at_risk = 0
    for aid, tainted in taint_map.items():
        if tainted <= 0:
            continue
        if aid in frozen or aid == CASH or aid.startswith("VICTIM") or aid == "SALARY":
            continue
        if aid in subgraph and nx.has_path(subgraph, aid, CASH):
            at_risk += tainted

    return at_risk


def _secured_by_freezing(taint_map, flow_graph, freeze_set):
    """
    Secured amount = the tainted money at risk before the freeze minus what
    is still at risk after it: taint in the frozen accounts, plus taint in
    accounts the freeze cuts off from CASH.

    This used to add up taint in every account that could not reach CASH
    after the freeze, including accounts that never could (an outsider a ring
    member paid). That counted money that was never at risk, and once ring
    members also made ordinary payments a freeze could "secure" more than
    130% of what was at risk.
    """
    return _at_risk(taint_map, flow_graph) - _at_risk(taint_map, flow_graph, frozen=set(freeze_set))


def recommend_freeze(ring, transactions, accounts, victim_txn_id=None,
                     k=3, exclude=None, as_of=None):
    """
    Recommend which accounts to freeze to secure the most tainted money.

    Parameters:
        ring              ring dict (must have member_ids)
        transactions      list of transaction dicts
        accounts          list of account dicts
        victim_txn_id     str (defaults to ring's first victim txn)
        k                 int  max accounts to freeze
        exclude           list of account IDs to exclude from freezing
        as_of             str  optional ISO timestamp cutoff

    Returns:
        {
            "freeze": [account_ids],
            "at_risk_before": int (paise),
            "secured": int (paise),
            "pct_stopped": float (0-1),
        }
    """
    if exclude is None:
        exclude = []
    exclude_set = set(exclude)

    if victim_txn_id is None:
        vtxns = ring.get("victim_txn_ids", [])
        if vtxns:
            victim_txn_id = vtxns[0]
        else:
            return {
                "freeze": [],
                "at_risk_before": 0,
                "secured": 0,
                "pct_stopped": 0.0,
            }

    # Build opening balances
    opening_balances = {}
    for acc in accounts:
        opening_balances[acc["_id"]] = acc.get("opening_balance", 0)
    opening_balances["SALARY"] = 10**15
    opening_balances[CASH] = 0
    for t in transactions:
        if t["from"].startswith("VICTIM"):
            opening_balances.setdefault(t["from"], 10**15)

    # Run taint trace
    bal, taint, flows, victim_amount = trace(
        transactions, opening_balances, victim_txn_id, as_of=as_of
    )

    # Build flow graph
    member_ids = ring["member_ids"]
    flow_graph = _build_flow_graph(member_ids, transactions, as_of=as_of)

    # At-risk before any freeze
    at_risk_before = _at_risk(taint, flow_graph)

    if at_risk_before == 0:
        return {
            "freeze": [],
            "at_risk_before": 0,
            "secured": 0,
            "pct_stopped": 0.0,
        }

    # Candidate accounts for freezing (ring members with taint, excluding CASH and excluded)
    freezable = [
        aid for aid in member_ids
        if aid not in exclude_set and taint.get(aid, 0) > 0
    ]

    best_freeze = []
    best_secured = 0

    if len(freezable) <= 15:
        # Brute force: try every combination of up to k accounts
        for size in range(1, min(k, len(freezable)) + 1):
            for combo in combinations(freezable, size):
                freeze_set = set(combo)
                secured = _secured_by_freezing(taint, flow_graph, freeze_set)
                if secured > best_secured:
                    best_secured = secured
                    best_freeze = list(combo)
    else:
        # Greedy: pick one account at a time
        remaining_freezable = list(freezable)
        current_frozen = set()
        for _ in range(min(k, len(remaining_freezable))):
            best_next = None
            best_next_secured = best_secured
            for aid in remaining_freezable:
                if aid in current_frozen:
                    continue
                test_set = current_frozen | {aid}
                secured = _secured_by_freezing(taint, flow_graph, test_set)
                if secured > best_next_secured:
                    best_next_secured = secured
                    best_next = aid
            if best_next is None:
                break
            current_frozen.add(best_next)
            best_secured = best_next_secured
            remaining_freezable.remove(best_next)
        best_freeze = sorted(current_frozen)

    pct_stopped = best_secured / max(at_risk_before, 1)

    return {
        "freeze": best_freeze,
        "at_risk_before": at_risk_before,
        "secured": best_secured,
        "pct_stopped": round(pct_stopped, 4),
    }


def compute_default_freeze(ring, transactions, accounts):
    """
    Compute default freeze recommendation for a ring (k=3, no exclusions).
    Returns the recommendation dict.
    """
    result = recommend_freeze(ring, transactions, accounts, k=3)
    return result
