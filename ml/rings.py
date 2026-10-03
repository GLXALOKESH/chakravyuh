"""
rings.py  —  Chakravyuh Ring Discovery & Role Classification
==============================================================
F4: Louvain community detection on combined transaction + identity graph.
F5: Rule-based role classification (coordinator → source → cashout → mule → relay → member).

Uses features computed by features.py.  Does NOT duplicate feature extraction.

Public API:
    discover_rings(accounts, transactions, identifiers, scored_df)
        -> list of ring dicts
    classify_roles(ring, transactions, identifiers, scored_df)
        -> dict  account_id -> {role, role_reason}

Reference: TRD §7.4, §7.5
"""

from collections import defaultdict
from datetime import datetime, timezone

import networkx as nx
import numpy as np

CASH = "CASH"

# ─────────────────────────────────────────────────────────────────
# 1.  RING DISCOVERY (Louvain)
# ─────────────────────────────────────────────────────────────────

def _build_ring_graph(candidate_ids, transactions, identifiers):
    """
    Build undirected account graph for Louvain.

    Edge weight = 1.0 per shared identifier + amount/median_ring_amount (capped at 3.0).
    Only edges between candidate accounts are included.
    """
    G = nx.Graph()
    G.add_nodes_from(candidate_ids)

    # Transaction edges (money flow between candidates)
    txn_amounts = defaultdict(float)   # (a, b) sorted tuple -> total amount
    for t in transactions:
        frm, to = t["from"], t["to"]
        if frm in candidate_ids and to in candidate_ids and frm != to:
            key = tuple(sorted([frm, to]))
            txn_amounts[key] += t["amount_paise"]

    # Median amount for normalisation
    all_amounts = list(txn_amounts.values())
    median_amt = float(np.median(all_amounts)) if all_amounts else 1.0
    median_amt = max(median_amt, 1.0)

    for (a, b), total in txn_amounts.items():
        w = min(total / median_amt, 3.0)
        if G.has_edge(a, b):
            G[a][b]["weight"] += w
        else:
            G.add_edge(a, b, weight=w)

    # Identity edges (shared identifiers between candidates)
    for rec in identifiers:
        members_in_set = [a for a in rec["account_ids"] if a in candidate_ids]
        for i, a in enumerate(members_in_set):
            for b in members_in_set[i + 1:]:
                if G.has_edge(a, b):
                    G[a][b]["weight"] += 1.0
                else:
                    G.add_edge(a, b, weight=1.0)

    return G


def discover_rings(accounts, transactions, identifiers, scored_df,
                   risk_threshold=0.5, min_members=3, min_mean_risk=0.6,
                   seed=42):
    """
    Discover fraud rings using Louvain community detection.

    1. Take accounts with risk_v2 >= risk_threshold (as 0-1 probability).
    2. Expand to accounts sharing an identifier or transaction with them.
    3. Run Louvain on the combined graph.
    4. Keep communities with >= min_members and mean risk_v2 >= min_mean_risk.

    Parameters:
        accounts       list of account dicts
        transactions   list of transaction dicts
        identifiers    list of identifier dicts
        scored_df      DataFrame with risk_v2, prob_v2 columns (index = account_id)
        risk_threshold float  (applied to prob_v2, 0-1 scale)
        min_members    int
        min_mean_risk  float  (applied to prob_v2, 0-1 scale)
        seed           int

    Returns list of ring dicts:
        {ring_id, member_ids, edges, identity_links, volume, risk, victim_txn_ids}
    """
    print("  [rings] Discovering rings...")

    all_account_ids = {a["_id"] for a in accounts}

    # Step 1: high-risk seed accounts
    if "prob_v2" in scored_df.columns:
        high_risk = set(scored_df[scored_df["prob_v2"] >= risk_threshold].index)
    else:
        high_risk = set(scored_df[scored_df["risk_v2"] >= risk_threshold * 100].index)

    if not high_risk:
        print("  [rings] No high-risk accounts found. Lowering threshold to 0.3...")
        if "prob_v2" in scored_df.columns:
            high_risk = set(scored_df[scored_df["prob_v2"] >= 0.3].index)
        else:
            high_risk = set(scored_df[scored_df["risk_v2"] >= 30].index)

    print(f"  [rings] {len(high_risk)} high-risk seed accounts")

    # Step 2: expand to neighbours (shared identifier or transaction)
    candidates = set(high_risk)

    # Expand via transactions
    for t in transactions:
        frm, to = t["from"], t["to"]
        if frm in high_risk and to in all_account_ids:
            candidates.add(to)
        if to in high_risk and frm in all_account_ids:
            candidates.add(frm)

    # Expand via shared identifiers
    for rec in identifiers:
        overlap = set(rec["account_ids"]) & high_risk
        if overlap:
            for a in rec["account_ids"]:
                if a in all_account_ids:
                    candidates.add(a)

    # Remove pseudo-accounts
    candidates = {a for a in candidates
                  if not a.startswith("VICTIM") and a not in ("SALARY", CASH)}

    print(f"  [rings] {len(candidates)} candidate accounts after expansion")

    if len(candidates) < min_members:
        print("  [rings] Too few candidates for ring detection.")
        return []

    # Step 3: build graph and run Louvain
    G = _build_ring_graph(candidates, transactions, identifiers)

    # Remove isolated nodes
    isolates = list(nx.isolates(G))
    G.remove_nodes_from(isolates)

    if len(G) < min_members:
        print("  [rings] Graph too small after removing isolates.")
        return []

    communities = nx.community.louvain_communities(G, weight="weight", seed=seed)
    print(f"  [rings] Louvain found {len(communities)} communities")

    # Step 4: filter communities
    rings = []
    ring_idx = 0

    for comm in communities:
        if len(comm) < min_members:
            continue

        # Mean risk of community members
        member_risks = []
        for aid in comm:
            if aid in scored_df.index:
                if "prob_v2" in scored_df.columns:
                    member_risks.append(float(scored_df.at[aid, "prob_v2"]))
                else:
                    member_risks.append(float(scored_df.at[aid, "risk_v2"]) / 100.0)

        if not member_risks:
            continue
        mean_risk = float(np.mean(member_risks))
        if mean_risk < min_mean_risk:
            continue

        ring_idx += 1
        ring_id = f"RING{ring_idx:02d}"
        member_ids = sorted(comm)

        # Build edge list for this ring
        ring_edges = []
        ring_volume = 0
        for t in transactions:
            if t["from"] in comm and t["to"] in comm:
                ring_edges.append({
                    "from": t["from"],
                    "to": t["to"],
                    "amount": t["amount_paise"],
                    "count": 1,
                })
                ring_volume += t["amount_paise"]

        # Aggregate edges (same from/to pair)
        edge_agg = defaultdict(lambda: {"amount": 0, "count": 0})
        for e in ring_edges:
            key = (e["from"], e["to"])
            edge_agg[key]["amount"] += e["amount"]
            edge_agg[key]["count"] += 1
        ring_edges = [
            {"from": k[0], "to": k[1], "amount": v["amount"], "count": v["count"]}
            for k, v in edge_agg.items()
        ]

        # Identity links within the ring
        ring_id_links = []
        for rec in identifiers:
            ring_overlap = [a for a in rec["account_ids"] if a in comm]
            if len(ring_overlap) >= 2:
                ring_id_links.append({
                    "identifier": rec["_id"],
                    "type": rec["type"],
                    "account_ids": ring_overlap,
                })

        # Find victim transactions (external inflow to ring members).
        #
        # The prefix match is deliberate and cannot be tightened to
        # `VICTIM_{ring_id}`: ring_id here is assigned by community discovery
        # order, not by which planted ring the community came from, so a
        # discovered RING01 has no relationship to a planted RING01. Matching the
        # label would leave every ring with zero victims.
        #
        # What matters is that the deposit lands on a member of THIS community,
        # which the `to in comm` clause already guarantees. That is the invariant
        # ml/tests/test_victim_ring_match.py asserts, rather than the label text,
        # which is incidental.
        victim_txn_ids = []
        for t in transactions:
            if (t.get("is_fraud") and
                    t["from"] not in comm and
                    t["to"] in comm and
                    t["from"].startswith("VICTIM")):
                victim_txn_ids.append(t["_id"])

        rings.append({
            "_id": ring_id,
            "ring_id": ring_id,
            "member_ids": member_ids,
            "edges": ring_edges,
            "identity_links": ring_id_links,
            "volume": ring_volume,
            "risk": round(mean_risk, 4),
            "geo_spread_km": 0,
            "victim_txn_ids": victim_txn_ids,
            "default_taint": {},
            "default_freeze": {},
        })

    print(f"  [rings] {len(rings)} rings passed filters")
    return rings


# ─────────────────────────────────────────────────────────────────
# 2.  ROLE CLASSIFICATION
# ─────────────────────────────────────────────────────────────────

def _parse_ts(s):
    try:
        return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except Exception:
        return None


def classify_roles(ring, transactions, identifiers, scored_df):
    """
    Assign roles to ring members using evidence-driven rules.

    Evaluation order (first match wins):
        1. Coordinator: shares identifiers with >= 3 ring members, < 10% volume
        2. Source: >= 50% inflow from outside ring, earliest active
        3. Cash-out: >= 50% outflow goes to CASH
        4. Mule: receives from source, pass_through >= 0.8, median_hold_min < 30
        5. Relay: both senders and receivers are ring members
        6. Member: anything else

    Returns dict: account_id -> {"role": str, "role_reason": str}
    """
    member_set = set(ring["member_ids"])
    roles = {}

    # Pre-compute per-member transaction stats
    inflow_from_ring = defaultdict(int)     # aid -> paise from ring members
    inflow_from_outside = defaultdict(int)  # aid -> paise from non-ring
    outflow_to_ring = defaultdict(int)      # aid -> paise to ring members
    outflow_to_cash = defaultdict(int)      # aid -> paise to CASH
    outflow_total = defaultdict(int)
    inflow_total = defaultdict(int)
    first_activity = {}                     # aid -> earliest timestamp
    senders_in_ring = defaultdict(set)      # aid -> set of ring senders
    receivers_in_ring = defaultdict(set)    # aid -> set of ring receivers

    for t in transactions:
        frm, to, amt = t["from"], t["to"], t["amount_paise"]
        ts = _parse_ts(t["ts"])

        if to in member_set:
            inflow_total[to] += amt
            if frm in member_set:
                inflow_from_ring[to] += amt
                senders_in_ring[to].add(frm)
            else:
                inflow_from_outside[to] += amt
            if ts and (to not in first_activity or ts < first_activity[to]):
                first_activity[to] = ts

        if frm in member_set:
            outflow_total[frm] += amt
            if to == CASH:
                outflow_to_cash[frm] += amt
            if to in member_set:
                outflow_to_ring[frm] += amt
                receivers_in_ring[frm].add(to)
            if ts and (frm not in first_activity or ts < first_activity[frm]):
                first_activity[frm] = ts

    # Identifier sharing count within ring
    id_share_count = defaultdict(int)   # aid -> number of ring members sharing any identifier
    for rec in identifiers:
        ring_members_in_rec = [a for a in rec["account_ids"] if a in member_set]
        if len(ring_members_in_rec) >= 2:
            for a in ring_members_in_rec:
                id_share_count[a] += len(ring_members_in_rec) - 1

    total_ring_volume = ring.get("volume", 1)

    # Identify sources first (needed for mule rule)
    source_ids = set()

    assigned = set()

    # Pass 1: Coordinator
    for aid in ring["member_ids"]:
        if aid in assigned:
            continue
        shares = id_share_count.get(aid, 0)
        vol_share = outflow_total.get(aid, 0) / max(total_ring_volume, 1)
        if shares >= 3 and vol_share < 0.10:
            roles[aid] = {
                "role": "coordinator",
                "role_reason": f"Shares identifiers with {shares} ring members, "
                               f"carries only {vol_share:.0%} of ring volume",
            }
            assigned.add(aid)

    # Pass 2: Source
    earliest_ts = None
    earliest_aid = None
    for aid in ring["member_ids"]:
        if aid in assigned:
            continue
        outside = inflow_from_outside.get(aid, 0)
        total_in = inflow_total.get(aid, 0)
        if total_in > 0 and outside / total_in >= 0.5:
            ts = first_activity.get(aid)
            if ts and (earliest_ts is None or ts < earliest_ts):
                earliest_ts = ts
                earliest_aid = aid

    if earliest_aid and earliest_aid not in assigned:
        roles[earliest_aid] = {
            "role": "source",
            "role_reason": "Receives majority of inflow from outside the ring "
                           "and is the earliest active member",
        }
        source_ids.add(earliest_aid)
        assigned.add(earliest_aid)

    # Pass 3: Cash-out
    for aid in ring["member_ids"]:
        if aid in assigned:
            continue
        total_out = outflow_total.get(aid, 0)
        cash_out = outflow_to_cash.get(aid, 0)
        if total_out > 0 and cash_out / total_out >= 0.5:
            roles[aid] = {
                "role": "cash-out",
                "role_reason": f"{cash_out / total_out:.0%} of outflow goes to ATM cash-out",
            }
            assigned.add(aid)

    # Pass 4: Mule
    for aid in ring["member_ids"]:
        if aid in assigned:
            continue
        receives_from_source = bool(senders_in_ring.get(aid, set()) & source_ids)
        if not receives_from_source:
            continue
        if aid in scored_df.index:
            pt = scored_df.at[aid, "pass_through"] if "pass_through" in scored_df.columns else 0
            hold = scored_df.at[aid, "median_hold_min"] if "median_hold_min" in scored_df.columns else 9999
            if pt >= 0.8 and hold < 30:
                roles[aid] = {
                    "role": "mule",
                    "role_reason": f"Receives from source, forwards {pt:.0%}, "
                                   f"holds only {hold:.0f} min",
                }
                assigned.add(aid)

    # Pass 5: Relay
    for aid in ring["member_ids"]:
        if aid in assigned:
            continue
        has_ring_senders = bool(senders_in_ring.get(aid))
        has_ring_receivers = bool(receivers_in_ring.get(aid))
        if has_ring_senders and has_ring_receivers:
            roles[aid] = {
                "role": "relay",
                "role_reason": "Both senders and receivers are ring members",
            }
            assigned.add(aid)

    # Pass 6: Member (default)
    for aid in ring["member_ids"]:
        if aid not in assigned:
            roles[aid] = {
                "role": "member",
                "role_reason": "Connected to ring but role not clearly determined",
            }

    return roles
