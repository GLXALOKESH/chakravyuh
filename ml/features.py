"""
features.py  —  Chakravyuh Behavioural Feature Engineering
===========================================================
Computes per-account features from transactions and identifiers.

All monetary values are INTEGER PAISE throughout.
The calling pipeline passes in pre-loaded data; this module is
a pure computation library with no I/O of its own.

Public API:
    compute_features(accounts, transactions, identifiers, geo=False)
        -> pandas.DataFrame  (one row per account, index = account_id)
"""

import math
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np
import pandas as pd

CASH = "CASH"


# ─────────────────────────────────────────────────────────────────
# 0.  HELPERS
# ─────────────────────────────────────────────────────────────────

def _parse(ts: str) -> datetime:
    return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def _haversine_km(lat1, lng1, lat2, lng2) -> float:
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return 2 * R * math.asin(math.sqrt(a))


# ─────────────────────────────────────────────────────────────────
# 1.  TRANSACTION-LEVEL FEATURE BUILDING
# ─────────────────────────────────────────────────────────────────

def _build_txn_index(transactions):
    """
    Returns:
        credits[aid]  -> list of (ts_dt, amount_paise)
        debits[aid]   -> list of (ts_dt, amount_paise, to)
        atm_txns[aid] -> list of (ts_dt, amount_paise, location)
    Sorted by timestamp inside each list.
    """
    credits  = defaultdict(list)
    debits   = defaultdict(list)
    atm_txns = defaultdict(list)

    for t in transactions:
        frm = t["from"]
        to  = t["to"]
        amt = t["amount_paise"]
        ts  = _parse(t["ts"])
        ch  = t.get("channel", "")
        loc = t.get("location")

        if frm not in ("SALARY", "CASH") and not frm.startswith("VICTIM"):
            debits[frm].append((ts, amt, to))
            if ch == "ATM":
                atm_txns[frm].append((ts, amt, loc))

        if to not in ("SALARY", "CASH") and not to.startswith("VICTIM"):
            credits[to].append((ts, amt, frm))

    # Sort
    for aid in credits:
        credits[aid].sort(key=lambda x: x[0])
    for aid in debits:
        debits[aid].sort(key=lambda x: x[0])
    for aid in atm_txns:
        atm_txns[aid].sort(key=lambda x: x[0])

    return credits, debits, atm_txns


# ─────────────────────────────────────────────────────────────────
# 2.  CORE BEHAVIOURAL FEATURES (V1 + V2)
# ─────────────────────────────────────────────────────────────────

def _compute_core(acc, credits, debits, atm_txns) -> dict:
    """
    Compute V1 features for a single account.
    All monetary values remain INTEGER PAISE inside; ratios are floats.

    Features:
        amount_in           total paise received (ex-salary)
        amount_out          total paise sent
        txn_in              count of incoming transactions
        txn_out             count of outgoing transactions
        pass_through        min(out,in)/max(in,1)  [0-1]
        median_hold_min     median minutes between credit and next debit
        velocity_per_hr     transactions per hour between first and last activity
        burst_10min         most transactions in any 10-min window
        counterparty_div    unique counterparties / txn_count
        in_degree           unique senders
        out_degree          unique receivers
        account_age_days    days from opened_at to first transaction
        atm_share           fraction of amount_out sent to CASH
    """
    aid   = acc["_id"]
    creds = credits.get(aid, [])
    debs  = debits.get(aid, [])
    atms  = atm_txns.get(aid, [])

    amount_in  = sum(a for _, a, *_ in creds)
    amount_out = sum(a for _, a, _ in debs)
    txn_in     = len(creds)
    txn_out    = len(debs)

    pass_through = min(amount_out, amount_in) / max(amount_in, 1)

    # Median hold time
    hold_mins = []
    cred_times = sorted(ts for ts, *_ in creds)
    deb_times  = sorted(ts for ts, _, _ in debs)
    ci = di = 0
    while ci < len(cred_times) and di < len(deb_times):
        if deb_times[di] >= cred_times[ci]:
            hold_mins.append((deb_times[di] - cred_times[ci]).total_seconds() / 60)
            ci += 1
            di += 1
        else:
            di += 1
    median_hold_min = float(np.median(hold_mins)) if hold_mins else 0.0

    # Velocity
    all_ts = sorted([ts for ts, *_ in creds] + [ts for ts, _, _ in debs])
    if len(all_ts) >= 2:
        span_hr = (all_ts[-1] - all_ts[0]).total_seconds() / 3600
        velocity_per_hr = len(all_ts) / max(span_hr, 1.0)
    else:
        velocity_per_hr = 0.0

    # Burst: most transactions in any 10-minute window
    if all_ts:
        burst_10min = 1
        for i, t_start in enumerate(all_ts):
            window_end = t_start.timestamp() + 600   # 10 min
            count = sum(1 for t in all_ts[i:] if t.timestamp() <= window_end)
            burst_10min = max(burst_10min, count)
    else:
        burst_10min = 0

    # Counterparty diversity
    senders   = {frm for _, _, frm in creds if frm}
    receivers = {to for _, _, to in debs if to}
    all_counterparties = senders | receivers
    txn_count = txn_in + txn_out
    counterparty_div = len(all_counterparties) / max(txn_count, 1)

    # Unique senders and receivers
    in_degree  = len(senders)
    out_degree = len(receivers)

    # Account age at first transaction
    try:
        opened_dt = datetime.strptime(acc["opened_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except Exception:
        opened_dt = None
    if all_ts and opened_dt:
        account_age_days = (all_ts[0] - opened_dt).total_seconds() / 86400
        account_age_days = max(account_age_days, 0.0)
    else:
        account_age_days = 0.0

    # ATM share
    atm_amount = sum(a for _, a, _ in atms)
    atm_share  = atm_amount / max(amount_out, 1)

    return {
        "amount_in":        amount_in,
        "amount_out":       amount_out,
        "txn_in":           txn_in,
        "txn_out":          txn_out,
        "pass_through":     round(pass_through, 4),
        "median_hold_min":  round(median_hold_min, 2),
        "velocity_per_hr":  round(velocity_per_hr, 4),
        "burst_10min":      burst_10min,
        "counterparty_div": round(counterparty_div, 4),
        "in_degree":        in_degree,
        "out_degree":       out_degree,
        "account_age_days": round(account_age_days, 2),
        "atm_share":        round(atm_share, 4),
    }


def transactions_from_meta(aid, credits_dict):
    """Approximate sender IDs from credit list — not stored, so just return empty."""
    return []


# ─────────────────────────────────────────────────────────────────
# 3.  IDENTITY FEATURES (V2 only)
# ─────────────────────────────────────────────────────────────────

def _compute_identity(acc, id_lookup, acc_opened_at, start_cutoff_days=14) -> dict:
    """
    id_lookup: account_id -> list of identifier records the account belongs to.
    acc_opened_at: dict  account_id -> datetime
    Returns:
        shared_device_n       other accounts sharing any device
        shared_phone_n        other accounts sharing any phone
        shared_ip_n           other accounts sharing any IP
        shared_any_new_n      sharing accounts that are < 14 days old
    """
    aid = acc["_id"]
    sharing = defaultdict(set)   # type -> set of other account_ids

    for rec in id_lookup.get(aid, []):
        typ = rec["type"]
        for other_id in rec["account_ids"]:
            if other_id != aid:
                sharing[typ].add(other_id)

    shared_device_n = len(sharing["device"])
    shared_phone_n  = len(sharing["phone"])
    shared_ip_n     = len(sharing["ip"])

    # New accounts among all sharing accounts
    all_sharing = sharing["device"] | sharing["phone"] | sharing["ip"]
    try:
        opened_dt = acc_opened_at.get(aid)
    except Exception:
        opened_dt = None

    new_count = 0
    for other_id in all_sharing:
        other_opened = acc_opened_at.get(other_id)
        if other_opened and opened_dt:
            age = abs((opened_dt - other_opened).total_seconds() / 86400)
            if age <= start_cutoff_days:
                new_count += 1

    return {
        "shared_device_n":  shared_device_n,
        "shared_phone_n":   shared_phone_n,
        "shared_ip_n":      shared_ip_n,
        "shared_any_new_n": new_count,
    }


# ─────────────────────────────────────────────────────────────────
# 4.  GEOGRAPHIC FEATURES (V2 + geo flag)
# ─────────────────────────────────────────────────────────────────

def _compute_geo(acc, atm_txns) -> dict:
    """
    home_cashout_km     median haversine distance from home to ATM withdrawals
    cashout_city_n      distinct cashout cities
    """
    aid    = acc["_id"]
    home   = acc.get("home", {})
    h_lat  = home.get("lat", 0.0)
    h_lng  = home.get("lng", 0.0)
    atms   = atm_txns.get(aid, [])

    if not atms:
        return {"home_cashout_km": 0.0, "cashout_city_n": 0}

    distances = []
    cities    = set()
    for _, _, loc in atms:
        if loc:
            dist = _haversine_km(h_lat, h_lng, loc.get("lat", h_lat), loc.get("lng", h_lng))
            distances.append(dist)
            cities.add(loc.get("city", ""))

    median_km = float(np.median(distances)) if distances else 0.0
    return {
        "home_cashout_km": round(median_km, 1),
        "cashout_city_n":  len(cities),
    }


# ─────────────────────────────────────────────────────────────────
# 5.  NEIGHBOUR RISK (V2)
# ─────────────────────────────────────────────────────────────────

def _compute_neighbour_risk(acc, id_lookup, risk_v1_map) -> dict:
    """
    neighbour_risk_v1: mean V1 risk of all accounts sharing any identifier.
    Called AFTER V1 scores are assigned.
    """
    aid = acc["_id"]
    neighbours = set()
    for rec in id_lookup.get(aid, []):
        for other_id in rec["account_ids"]:
            if other_id != aid:
                neighbours.add(other_id)

    if not neighbours:
        return {"neighbour_risk_v1": 0.0}

    risks = [risk_v1_map.get(n, 0.0) for n in neighbours]
    return {"neighbour_risk_v1": round(float(np.mean(risks)), 4)}


# ─────────────────────────────────────────────────────────────────
# 6.  PUBLIC API
# ─────────────────────────────────────────────────────────────────

def compute_features(accounts: list, transactions: list, identifiers: list,
                     risk_v1_map: dict = None, geo: bool = False) -> pd.DataFrame:
    """
    Compute the full feature matrix for all accounts.

    Parameters:
        accounts      list of account dicts
        transactions  list of transaction dicts
        identifiers   list of identifier dicts
        risk_v1_map   dict account_id -> float  (needed for neighbour_risk_v1)
        geo           if True, include geographic features in V2

    Returns:
        pd.DataFrame with index = account_id, columns = all features.
        Columns prefixed "v2_only_" are excluded from V1 training.
    """
    print("  [features] Building transaction index...")
    credits, debits, atm_txns = _build_txn_index(transactions)

    # Build identity lookup: account_id -> list of identifier records
    id_lookup = defaultdict(list)
    for rec in identifiers:
        for a in rec["account_ids"]:
            id_lookup[a].append(rec)

    # opened_at datetime map
    acc_opened_at = {}
    for acc in accounts:
        try:
            acc_opened_at[acc["_id"]] = datetime.strptime(
                acc["opened_at"], "%Y-%m-%dT%H:%M:%SZ"
            ).replace(tzinfo=timezone.utc)
        except Exception:
            acc_opened_at[acc["_id"]] = None

    # Build better credit/debit structures with sender info
    # Re-index with sender info for in_degree
    sender_map  = defaultdict(set)   # account_id -> set of unique senders
    receiver_map = defaultdict(set)  # account_id -> set of unique receivers
    for t in transactions:
        frm = t["from"]
        to  = t["to"]
        if frm not in ("SALARY", CASH) and not frm.startswith("VICTIM"):
            receiver_map[frm].add(to)
        if to not in ("SALARY", CASH) and not to.startswith("VICTIM"):
            sender_map[to].add(frm)

    rows = []
    print(f"  [features] Computing features for {len(accounts)} accounts...")

    for acc in accounts:
        aid  = acc["_id"]
        row  = {"account_id": aid}

        # Core features
        creds = credits.get(aid, [])
        debs  = debits.get(aid, [])
        atms  = atm_txns.get(aid, [])

        amount_in  = sum(a for _, a, *_ in creds)
        amount_out = sum(a for _, a, _ in debs)
        txn_in     = len(creds)
        txn_out    = len(debs)

        pass_through = min(amount_out, amount_in) / max(amount_in, 1)

        # Median hold time (minutes between credit and next debit)
        hold_mins = []
        cred_times = sorted(ts for ts, *_ in creds)
        deb_times  = sorted(ts for ts, _, _ in debs)
        ci = di = 0
        while ci < len(cred_times) and di < len(deb_times):
            if deb_times[di] >= cred_times[ci]:
                hold_mins.append((deb_times[di] - cred_times[ci]).total_seconds() / 60)
                ci += 1
                di += 1
            else:
                di += 1
        median_hold_min = float(np.median(hold_mins)) if hold_mins else 9999.0

        # Transaction velocity
        all_ts = sorted([ts for ts, *_ in creds] + [ts for ts, _, _ in debs])
        if len(all_ts) >= 2:
            span_hr = max((all_ts[-1] - all_ts[0]).total_seconds() / 3600, 0.0167)
            velocity_per_hr = len(all_ts) / span_hr
        else:
            velocity_per_hr = 0.0

        # Burst: max transactions in any 10-minute window
        burst_10min = 0
        if all_ts:
            ts_stamps = [t.timestamp() for t in all_ts]
            for i, t0 in enumerate(ts_stamps):
                count = sum(1 for t1 in ts_stamps[i:] if t1 - t0 <= 600)
                burst_10min = max(burst_10min, count)

        # Counterparty diversity
        all_counterparties = sender_map[aid] | receiver_map[aid]
        txn_count = txn_in + txn_out
        counterparty_div = len(all_counterparties) / max(txn_count, 1)

        in_degree  = len(sender_map[aid])
        out_degree = len(receiver_map[aid])

        # Account age at first transaction
        opened_dt = acc_opened_at.get(aid)
        if all_ts and opened_dt:
            account_age_days = max((all_ts[0] - opened_dt).total_seconds() / 86400, 0.0)
        else:
            account_age_days = 0.0

        # ATM share
        atm_amount = sum(a for _, a, _ in atms)
        atm_share  = atm_amount / max(amount_out, 1)

        row.update({
            "amount_in":        amount_in,
            "amount_out":       amount_out,
            "txn_in":           txn_in,
            "txn_out":          txn_out,
            "pass_through":     round(pass_through, 6),
            "median_hold_min":  round(median_hold_min, 2),
            "velocity_per_hr":  round(velocity_per_hr, 4),
            "burst_10min":      burst_10min,
            "counterparty_div": round(counterparty_div, 6),
            "in_degree":        in_degree,
            "out_degree":       out_degree,
            "account_age_days": round(account_age_days, 2),
            "atm_share":        round(atm_share, 6),
        })

        # Identity features (V2 only)
        id_feat = _compute_identity(acc, id_lookup, acc_opened_at)
        row.update(id_feat)

        # Neighbour risk (V2 only) — zero first pass, filled later
        row["neighbour_risk_v1"] = 0.0

        # Geo features (V2 + geo flag only)
        if geo:
            geo_feat = _compute_geo(acc, atm_txns)
            row.update(geo_feat)
        else:
            row["home_cashout_km"] = 0.0
            row["cashout_city_n"]  = 0

        rows.append(row)

    df = pd.DataFrame(rows).set_index("account_id")

    # Fill neighbour risk if V1 map is provided
    if risk_v1_map:
        print("  [features] Computing neighbour risk...")
        for aid, row in df.iterrows():
            neighbours = set()
            for rec in id_lookup.get(aid, []):
                for oid in rec["account_ids"]:
                    if oid != aid:
                        neighbours.add(oid)
            if neighbours:
                risks = [risk_v1_map.get(n, 0.0) for n in neighbours if n in risk_v1_map]
                df.at[aid, "neighbour_risk_v1"] = float(np.mean(risks)) if risks else 0.0

    print(f"  [features] Done. Shape: {df.shape}")
    return df


# ─────────────────────────────────────────────────────────────────
# 7.  FEATURE SETS (exported for models.py)
# ─────────────────────────────────────────────────────────────────

V1_FEATURES = [
    "amount_in", "amount_out", "txn_in", "txn_out",
    "pass_through", "median_hold_min", "velocity_per_hr",
    "burst_10min", "counterparty_div", "in_degree", "out_degree",
    "account_age_days", "atm_share",
]

V2_EXTRA_FEATURES = [
    "shared_device_n", "shared_phone_n", "shared_ip_n",
    "shared_any_new_n", "neighbour_risk_v1",
]

V2_GEO_FEATURES = [
    "home_cashout_km", "cashout_city_n",
]

def v2_features(geo: bool = False) -> list:
    base = V1_FEATURES + V2_EXTRA_FEATURES
    if geo:
        base = base + V2_GEO_FEATURES
    return base


# ─────────────────────────────────────────────────────────────────
# 8.  SIGNAL LABELS  (for "Why Flagged" explanation)
# ─────────────────────────────────────────────────────────────────

SIGNAL_LABELS = {
    "pass_through":        lambda v: f"Forwards {int(v*100)}% of what it receives",
    "burst_10min":         lambda v: f"{int(v)} transactions in 10 minutes",
    "velocity_per_hr":     lambda v: f"{v:.1f} transactions per hour",
    "median_hold_min":     lambda v: f"Holds money only {v:.0f} minutes before forwarding",
    "atm_share":           lambda v: f"{int(v*100)}% of outflow goes to cash (ATM)",
    "account_age_days":    lambda v: f"Account opened only {v:.0f} days before first use",
    "shared_device_n":     lambda v: f"Shares a device with {int(v)} other accounts",
    "shared_phone_n":      lambda v: f"Shares a phone number with {int(v)} other accounts",
    "shared_ip_n":         lambda v: f"Shares an IP address with {int(v)} accounts",
    "shared_any_new_n":    lambda v: f"Linked to {int(v)} recently opened accounts",
    "neighbour_risk_v1":   lambda v: f"Connected to high-risk accounts (avg risk {v:.2f})",
    "in_degree":           lambda v: f"Receives from {int(v)} unique senders",
    "out_degree":          lambda v: f"Sends to {int(v)} unique receivers",
    "counterparty_div":    lambda v: f"Low counterparty diversity ({v:.2f})",
    "home_cashout_km":     lambda v: f"Withdraws cash {v:.0f} km from home branch",
    "amount_out":          lambda v: f"Total outflow ₹{int(v)//100:,}",
}


def explain_signals(feature_contributions: list) -> list:
    """
    Convert a list of (feature_name, shap_value, feature_value) tuples
    into human-readable signal dicts.

    Returns list of {"feature": str, "label": str, "weight": float}
    sorted by |weight| descending, keeping top 3 positive contributions.
    """
    signals = []
    for feat, shap_val, feat_val in feature_contributions:
        if shap_val <= 0:
            continue
        label_fn = SIGNAL_LABELS.get(feat)
        if label_fn:
            try:
                label = label_fn(feat_val)
            except Exception:
                label = feat
        else:
            label = feat
        signals.append({
            "feature": feat,
            "label":   label,
            "weight":  round(float(shap_val), 4),
        })
    signals.sort(key=lambda x: -x["weight"])
    return signals[:3]
