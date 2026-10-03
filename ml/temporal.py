"""
temporal.py  —  Chakravyuh Temporal Fund-Flow Intelligence Engine
==================================================================
Analyzes multi-hop transaction sequences to identify temporally coherent
movements of funds across accounts.

Strict Temporal Invariant:
    Every hop k+1 must have ts(k+1) > ts(k). Same-timestamp and reverse-time
    transitions are strictly rejected.

Semantic Boundary & Scope:
    This module identifies temporally consistent transaction chains based
    strictly on chronological timestamps and directional graph adjacency.
    It does NOT establish:
      - Monetary provenance (whether specific deposited currency units funded
        a subsequent transfer)
      - Proportional taint (handled separately by ml.taint)
      - Balance conservation or intermediate account solvency
      - That funds in a later transaction originated from an earlier transaction
      - Fraudulent intent or malice

All monetary calculations use integer paise.

Public API:
    analyze_temporal_fund_flows(transactions, ...) -> dict
"""

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple


CASH = "CASH"
SALARY = "SALARY"
TERMINAL_SINKS = {CASH}
SOURCE_ONLY_PREFIXES = ("VICTIM",)
SOURCE_ONLY_ACCOUNTS = {SALARY}


def _parse_ts(ts_str: str) -> datetime:
    """Parse ISO-8601 UTC timestamp string to datetime object."""
    try:
        return datetime.strptime(ts_str, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except Exception:
        # Fallback for ISO strings with microsecond or offset if encountered
        iso_clean = ts_str.replace("Z", "+00:00")
        return datetime.fromisoformat(iso_clean)


def _is_terminal_sink(account_id: str) -> bool:
    """Check if account is a terminal sink from which no further hops can originate."""
    return account_id in TERMINAL_SINKS


def _is_source_only(account_id: str) -> bool:
    """Check if account is a source-only origin (cannot be intermediate receiver)."""
    if account_id in SOURCE_ONLY_ACCOUNTS:
        return True
    for prefix in SOURCE_ONLY_PREFIXES:
        if account_id.startswith(prefix):
            return True
    return False


def analyze_temporal_fund_flows(
    transactions: List[Dict[str, Any]],
    rings: Optional[List[Dict[str, Any]]] = None,
    taint_results: Optional[Dict[str, Any]] = None,
    accounts: Optional[List[Dict[str, Any]]] = None,
    scored_df: Optional[Any] = None,
    min_hops: int = 2,
    max_hops: int = 5,
    max_inter_hop_minutes: float = 2880.0,  # 48 hours
    min_amount_paise: int = 0,
    max_paths: int = 1000,
) -> Dict[str, Any]:
    """
    Identifies and evaluates time-consistent multi-hop transaction paths.

    Important Semantic Clarification:
        This function identifies candidate causal chains where transaction timing
        permits fund movement (t_next > t_prev). It does NOT establish true monetary
        provenance, balance sufficiency, or proportional taint attribution.

    Parameters:
        transactions: List of transaction dicts with keys:
                      _id, ts, from, to, amount_paise
        rings: Optional list of discovered ring dicts
        taint_results: Optional taint tracing outputs
        accounts: Optional list of account dicts
        scored_df: Optional DataFrame of scored accounts
        min_hops: Minimum number of hops for a valid path (default: 2)
        max_hops: Maximum traversal depth (default: 5)
        max_inter_hop_minutes: Maximum allowed time gap between consecutive hops
        min_amount_paise: Minimum transaction amount in paise to consider
        max_paths: Safety cap to prevent combinatorial explosion

    Returns:
        Dictionary following the structured output contract:
        {
            "summary": {
                "total_paths_identified": int,
                "avg_hop_latency_minutes": float,
                "fastest_path_minutes": float | None,
                "truncated": bool
            },
            "paths": [ ... ]
        }
    """
    if not transactions or max_hops < 1 or min_hops < 1:
        return {
            "summary": {
                "total_paths_identified": 0,
                "avg_hop_latency_minutes": 0.0,
                "fastest_path_minutes": None,
                "truncated": False,
            },
            "paths": [],
        }

    # 1. Normalise and index transactions
    # outgoing[account_id] = list of (dt, txn_dict) sorted by (dt, txn_id)
    outgoing = defaultdict(list)
    parsed_txns = []

    for t in transactions:
        amt = t.get("amount_paise", 0)
        if amt < min_amount_paise:
            continue
        frm = t.get("from")
        to = t.get("to")
        if not frm or not to or frm == to:
            continue

        ts_raw = t.get("ts", "")
        if not ts_raw:
            continue

        dt = _parse_ts(ts_raw)
        item = (dt, t)
        parsed_txns.append(item)
        if not _is_terminal_sink(frm):
            outgoing[frm].append(item)

    # Sort each outgoing bucket deterministically
    for aid in outgoing:
        outgoing[aid].sort(key=lambda x: (x[0], x[1].get("_id", "")))

    # Sort all initial candidate seed transactions deterministically
    parsed_txns.sort(key=lambda x: (x[0], x[1].get("_id", "")))

    discovered_paths: List[List[Tuple[datetime, Dict[str, Any]]]] = []
    was_truncated = False

    # 2. Depth-First Search for time-consistent paths
    def _dfs(
        current_chain: List[Tuple[datetime, Dict[str, Any]]],
        visited_nodes: Set[str],
    ):
        nonlocal was_truncated
        if len(discovered_paths) >= max_paths:
            was_truncated = True
            return

        last_dt, last_txn = current_chain[-1]
        last_to = last_txn["to"]

        # If current chain satisfies min_hops, record it as a valid path
        if len(current_chain) >= min_hops:
            discovered_paths.append(list(current_chain))
            if len(discovered_paths) >= max_paths:
                was_truncated = True
                return

        # Check if we can extend the path
        if len(current_chain) >= max_hops:
            return
        if _is_terminal_sink(last_to):
            return
        if _is_source_only(last_to):
            return

        # Search candidates from last_to
        for next_dt, next_txn in outgoing.get(last_to, []):
            if len(discovered_paths) >= max_paths:
                was_truncated = True
                return

            # Strict temporal constraint: next hop must strictly succeed last hop
            if next_dt <= last_dt:
                continue

            # Maximum inter-hop time window constraint
            gap_minutes = (next_dt - last_dt).total_seconds() / 60.0
            if gap_minutes > max_inter_hop_minutes:
                # Since outgoing list is sorted chronologically, all subsequent txns will exceed gap
                break

            next_to = next_txn["to"]

            # Cycle prevention: target node must not already be in visited chain
            if next_to in visited_nodes:
                continue

            visited_nodes.add(next_to)
            current_chain.append((next_dt, next_txn))

            _dfs(current_chain, visited_nodes)

            current_chain.pop()
            visited_nodes.remove(next_to)

    # Initiate DFS from each valid initial transaction
    for start_dt, start_txn in parsed_txns:
        if len(discovered_paths) >= max_paths:
            was_truncated = True
            break
        start_from = start_txn["from"]
        start_to = start_txn["to"]

        visited = {start_from, start_to}
        initial_chain = [(start_dt, start_txn)]
        _dfs(initial_chain, visited)

    # 3. Format and construct structured output
    formatted_paths = []
    total_hop_latencies: List[float] = []
    min_duration_minutes: Optional[float] = None

    # Deterministic sorting of discovered paths
    # Sort primarily by start_time, then duration, then from_account, then path length
    discovered_paths.sort(
        key=lambda chain: (
            chain[0][0],  # start datetime
            (chain[-1][0] - chain[0][0]).total_seconds(),  # duration
            chain[0][1].get("from", ""),
            chain[-1][1].get("to", ""),
            len(chain),
            chain[0][1].get("_id", ""),
        )
    )

    for idx, raw_chain in enumerate(discovered_paths, start=1):
        chain_len = len(raw_chain)
        start_dt, start_txn = raw_chain[0]
        end_dt, end_txn = raw_chain[-1]

        duration_sec = (end_dt - start_dt).total_seconds()
        duration_minutes = round(duration_sec / 60.0, 2)

        if min_duration_minutes is None or duration_minutes < min_duration_minutes:
            min_duration_minutes = duration_minutes

        initial_amt = int(start_txn.get("amount_paise", 0))
        final_amt = int(end_txn.get("amount_paise", 0))

        if initial_amt > 0:
            decay_pct = round(((initial_amt - final_amt) / initial_amt) * 100.0, 2)
        else:
            decay_pct = 0.0

        chain_hops = []
        for step_idx, (hop_dt, hop_txn) in enumerate(raw_chain, start=1):
            if step_idx == 1:
                latency = None
            else:
                prev_dt = raw_chain[step_idx - 2][0]
                lat_min = round((hop_dt - prev_dt).total_seconds() / 60.0, 2)
                latency = lat_min
                total_hop_latencies.append(lat_min)

            chain_hops.append({
                "step": step_idx,
                "from_account": hop_txn.get("from", ""),
                "to_account": hop_txn.get("to", ""),
                "txn_id": hop_txn.get("_id", ""),
                "timestamp": hop_txn.get("ts", ""),
                "amount_paise": int(hop_txn.get("amount_paise", 0)),
                "latency_from_prev_min": latency,
            })

        formatted_paths.append({
            "path_id": f"PATH_{idx:04d}",
            "hops": chain_len,
            "start_time": start_txn.get("ts", ""),
            "end_time": end_txn.get("ts", ""),
            "duration_minutes": duration_minutes,
            "initial_amount_paise": initial_amt,
            "final_amount_paise": final_amt,
            "amount_decay_pct": decay_pct,
            "chain": chain_hops,
        })

    avg_latency = (
        round(sum(total_hop_latencies) / len(total_hop_latencies), 2)
        if total_hop_latencies
        else 0.0
    )

    return {
        "summary": {
            "total_paths_identified": len(formatted_paths),
            "avg_hop_latency_minutes": avg_latency,
            "fastest_path_minutes": min_duration_minutes,
            "truncated": was_truncated,
        },
        "paths": formatted_paths,
    }
