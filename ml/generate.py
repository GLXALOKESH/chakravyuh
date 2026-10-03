"""
generate.py  —  Chakravyuh Synthetic Data Generator
=====================================================
Generates three profiles: demo, train, test.
All monetary values stored as INTEGER PAISE (1 rupee = 100 paise).
All data is 100% synthetic. Fixed seeds for reproducibility.

Output per profile (written to data/<profile>/):
  accounts.json       — account records
  identifiers.json    — device / phone / IP records
  transactions.json   — all transactions (sorted by ts)
  ground_truth.json   — ring membership, roles, victim txn IDs (NEVER sent to UI)

Usage:
  python generate.py --profile demo
  python generate.py --profile train
  python generate.py --profile test
  python generate.py --all
"""

import argparse
import json
import math
import random
import string
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ─────────────────────────────────────────────────────────────────
# 1.  PROFILE CONFIGURATION
# ─────────────────────────────────────────────────────────────────

PROFILE_CONFIG = {
    "demo": {
        "seed":          42,
        "n_accounts":    900,            # ↑ from 600  — wider normal population
        "n_normal_txns": 8000,           # ↑ from 5000 — more realistic traffic density
        "days":          14,             # ↑ from 7    — two-week window for richer patterns
        "n_rings":       5,              # ↑ from 3    — patterns A, B, C + 2 more (A2, B2)
        "include_d":     True,           # now ON — pattern D (cross-border hop) included
        "start_date":    "2026-09-20T00:00:00Z",
        "account_e":     True,           # recruitment candidate
    },
    "train": {
        "seed":          1337,
        "n_accounts":    6000,
        "n_normal_txns": 50000,
        "days":          30,
        "n_rings":       40,         # patterns A, B, C only
        "include_d":     False,
        "start_date":    "2026-09-01T00:00:00Z",
        "account_e":     False,
    },
    "test": {
        "seed":          9001,
        "n_accounts":    3000,
        "n_normal_txns": 25000,
        "days":          30,
        "n_rings":       20,         # patterns A, B, C, D (D held-out)
        "include_d":     True,
        "start_date":    "2026-09-01T00:00:00Z",
        "account_e":     False,
    },
}

# ─────────────────────────────────────────────────────────────────
# 2.  STATIC TABLES
# ─────────────────────────────────────────────────────────────────


BANKS = [
    "State Bank", "HDFC Bank", "ICICI Bank", "Axis Bank", "PNB",
    "Canara Bank", "Union Bank", "Kotak Bank", "Yes Bank", "IDBI Bank",
]

CHANNELS = ["UPI", "IMPS", "NEFT", "ATM"]

INDIAN_CITIES = [
    {"city": "Mumbai",    "lat": 19.0760, "lng": 72.8777},
    {"city": "Delhi",     "lat": 28.6139, "lng": 77.2090},
    {"city": "Bengaluru", "lat": 12.9716, "lng": 77.5946},
    {"city": "Hyderabad", "lat": 17.3850, "lng": 78.4867},
    {"city": "Chennai",   "lat": 13.0827, "lng": 80.2707},
    {"city": "Kolkata",   "lat": 22.5726, "lng": 88.3639},
    {"city": "Pune",      "lat": 18.5204, "lng": 73.8567},
    {"city": "Ahmedabad", "lat": 23.0225, "lng": 72.5714},
    {"city": "Jaipur",    "lat": 26.9124, "lng": 75.7873},
    {"city": "Lucknow",   "lat": 26.8467, "lng": 80.9462},
    {"city": "Bhopal",    "lat": 23.2599, "lng": 77.4126},
    {"city": "Surat",     "lat": 21.1702, "lng": 72.8311},
    {"city": "Nagpur",    "lat": 21.1458, "lng": 79.0882},
    {"city": "Patna",     "lat": 25.5941, "lng": 85.1376},
    {"city": "Kochi",     "lat":  9.9312, "lng": 76.2673},
]

FIRST_NAMES = [
    "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Reyansh", "Mohammed",
    "Ananya", "Diya", "Priya", "Meera", "Kavya", "Sneha", "Riya",
    "Rohan", "Kiran", "Sanjay", "Amit", "Suresh", "Rajesh", "Vikram",
    "Deepa", "Sunita", "Pooja", "Neha", "Anjali", "Swati", "Lakshmi",
    "Rahul", "Nikhil", "Kunal", "Harsh", "Yash", "Dev", "Ishaan",
    "Nisha", "Manisha", "Rekha", "Seema", "Geeta", "Rita", "Uma",
]

LAST_NAMES = [
    "Sharma", "Verma", "Gupta", "Singh", "Kumar", "Patel", "Mehta",
    "Shah", "Joshi", "Nair", "Pillai", "Reddy", "Rao", "Naidu",
    "Jain", "Agarwal", "Bansal", "Mittal", "Goel", "Saxena",
    "Mishra", "Pandey", "Tiwari", "Dubey", "Yadav", "Chauhan",
    "Murthy", "Iyer", "Menon", "Krishnan",
]

CASH = "CASH"

# ─────────────────────────────────────────────────────────────────
# 3.  HELPERS
# ─────────────────────────────────────────────────────────────────

def fmt_ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_ts(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def haversine_km(lat1, lng1, lat2, lng2):
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return 2 * R * math.asin(math.sqrt(a))


def jitter(lat, lng, rng, km=5.0):
    d_lat = (rng.random() - 0.5) * 2 * km / 111.0
    d_lng = (rng.random() - 0.5) * 2 * km / (111.0 * math.cos(math.radians(lat)))
    return round(lat + d_lat, 4), round(lng + d_lng, 4)


def rand_name(rng):
    f = rng.choice(FIRST_NAMES)
    l = rng.choice(LAST_NAMES)
    i = rng.choice(string.ascii_uppercase)
    return f"{f} {i}. {l}"


def rand_city(rng):
    c = rng.choice(INDIAN_CITIES)
    lat, lng = jitter(c["lat"], c["lng"], rng, km=2.0)
    return {"city": c["city"], "lat": lat, "lng": lng}


def aid(n):  return f"ACC{n:04d}"
def tid(n):  return f"TXN{n:06d}"
def did(n):  return f"DEV{n:04d}"
def pid(n):  return f"PHN{n:04d}"
def iid(n):  return f"IP{n:04d}"


# ─────────────────────────────────────────────────────────────────
# 4.  ACCOUNT FACTORIES
# ─────────────────────────────────────────────────────────────────

def make_accounts(n, rng, start_dt, id_offset=0):
    """Normal accounts: opened 0–365 days before start_dt, a few of them in the last week."""
    accs = []
    for i in range(n):
        account_id = aid(i + id_offset)
        # A share are new customers, so a young account is not proof of a mule (6b).
        days_before = rng.randint(0, 6) if rng.random() < NEW_ACCOUNT_SHARE else rng.randint(0, 365)
        opened_at = start_dt - timedelta(days=days_before)
        balance_rupees = rng.randint(100, 500_000)
        accs.append({
            "_id":             account_id,
            "holder":          rand_name(rng),
            "bank":            rng.choice(BANKS),
            "home":            rand_city(rng),
            "opened_at":       fmt_ts(opened_at),
            "opening_balance": balance_rupees * 100,   # INTEGER PAISE
            "features":        {},
            "risk_v1":         0.0,
            "risk_v2":         0.0,
            "signals":         [],
            "ring_id":         None,
            "role":            None,
            "role_reason":     None,
        })
    return accs


def make_ring_accounts(n, rng, start_dt, id_offset, days_window=3):
    """Ring members: newly opened, low balance."""
    accs = []
    for i in range(n):
        account_id = aid(i + id_offset)
        days_ago = rng.randint(0, days_window)
        opened_at = start_dt - timedelta(days=days_ago)
        balance_rupees = rng.randint(200, 5_000)
        accs.append({
            "_id":             account_id,
            "holder":          rand_name(rng),
            "bank":            rng.choice(BANKS),
            "home":            rand_city(rng),
            "opened_at":       fmt_ts(opened_at),
            "opening_balance": balance_rupees * 100,
            "features":        {},
            "risk_v1":         0.0,
            "risk_v2":         0.0,
            "signals":         [],
            "ring_id":         None,
            "role":            None,
            "role_reason":     None,
        })
    return accs


# ─────────────────────────────────────────────────────────────────
# 5.  IDENTIFIER MANAGEMENT
# ─────────────────────────────────────────────────────────────────

def assign_normal_identifiers(accounts, rng, n_devs, n_phones, n_ips, share_rate=0.04):
    """Give each normal account a device, phone, IP. Inject family-sharing noise."""
    device_pool = [did(i) for i in range(n_devs)]
    phone_pool  = [pid(i) for i in range(n_phones)]
    ip_pool     = [iid(i) for i in range(n_ips)]

    dev_assign   = {}
    phone_assign = {}
    ip_assign    = {}

    for acc in accounts:
        a = acc["_id"]
        dev_assign[a]   = rng.choice(device_pool)
        phone_assign[a] = rng.choice(phone_pool)
        ip_assign[a]    = rng.choice(ip_pool)

    # Family sharing noise: share_rate fraction of accounts share a device or phone
    all_ids = [a["_id"] for a in accounts]
    n_pairs = max(1, int(len(accounts) * share_rate))
    for _ in range(n_pairs):
        a1, a2 = rng.sample(all_ids, 2)
        if rng.random() < 0.6:
            dev_assign[a2] = dev_assign[a1]
        else:
            phone_assign[a2] = phone_assign[a1]

    # Build identifier records
    dev_map   = defaultdict(list)
    phone_map = defaultdict(list)
    ip_map    = defaultdict(list)

    for acc in accounts:
        a = acc["_id"]
        dev_map[dev_assign[a]].append(a)
        phone_map[phone_assign[a]].append(a)
        ip_map[ip_assign[a]].append(a)

    id_list = []
    for k, v in dev_map.items():
        id_list.append({"_id": k, "type": "device", "account_ids": sorted(set(v))})
    for k, v in phone_map.items():
        id_list.append({"_id": k, "type": "phone",  "account_ids": sorted(set(v))})
    for k, v in ip_map.items():
        id_list.append({"_id": k, "type": "ip",     "account_ids": sorted(set(v))})

    return id_list


def upsert_identifier(id_list, identifier_id, id_type, account_ids):
    """Add or update an identifier record (used for ring shared infra)."""
    for rec in id_list:
        if rec["_id"] == identifier_id and rec["type"] == id_type:
            for a in account_ids:
                if a not in rec["account_ids"]:
                    rec["account_ids"].append(a)
            return
    id_list.append({"_id": identifier_id, "type": id_type,
                    "account_ids": list(account_ids)})


# ─────────────────────────────────────────────────────────────────
# 6.  NORMAL TRANSACTION GENERATOR
# ─────────────────────────────────────────────────────────────────

def gen_normal_txns(accounts, n_target, start_dt, days, rng, ctr, balances):
    """
    Generate realistic normal transactions.
    All amounts are INTEGER PAISE.
    Guarantees no balance goes negative.

    ctr: [int]  mutable counter for unique TXN IDs.
    balances: dict  account_id -> current INTEGER PAISE balance.
    """
    txns = []
    all_aids = [a["_id"] for a in accounts]
    total_sec = int(days * 86400)

    # Salary credits — timestamps in first 10 MINUTES so they always sort BEFORE
    # P2P/ATM transactions regardless of the random P2P timestamp window.
    salary_window = 600   # 10 minutes in seconds
    for acc in accounts:
        a = acc["_id"]
        for _ in range(rng.randint(1, 2)):
            salary = rng.randint(20_000, 200_000) * 100
            ts = start_dt + timedelta(seconds=rng.randint(0, salary_window))
            balances[a] = balances.get(a, 0) + salary
            t = {
                "_id": tid(ctr[0]),
                "from": "SALARY", "to": a,
                "amount_paise": salary,
                "ts": fmt_ts(ts),
                "channel": rng.choice(["NEFT", "IMPS"]),
                "location": None, "is_fraud": False,
            }
            ctr[0] += 1
            txns.append(t)

    # P2P / merchant / ATM
    generated = 0
    attempts = 0

    while generated < n_target and attempts < n_target * 30:
        attempts += 1
        frm = rng.choice(all_aids)
        bal = balances.get(frm, 0)
        if bal < 10_000:   # need ₹100
            continue

        txn_type = rng.choices(["p2p", "merchant", "atm"], weights=[0.40, 0.45, 0.15])[0]

        if txn_type == "atm":
            to = CASH
            max_amt = min(bal, 20_000 * 100)
            if max_amt < 50_000:
                continue
            amount = rng.randint(100, max_amt // 100) * 100
            channel = "ATM"
            acc_obj = next((a for a in accounts if a["_id"] == frm), None)
            if acc_obj and rng.random() < 0.10:
                c = rng.choice(INDIAN_CITIES)
                lat, lng = jitter(c["lat"], c["lng"], rng)
                location = {"city": c["city"], "lat": lat, "lng": lng}
            elif acc_obj:
                h = acc_obj["home"]
                lat, lng = jitter(h["lat"], h["lng"], rng)
                location = {"city": h["city"], "lat": lat, "lng": lng}
            else:
                location = None
        else:
            to = rng.choice(all_aids)
            if to == frm:
                continue
            if txn_type == "p2p":
                max_amt = min(bal, 50_000 * 100)
            else:
                max_amt = min(bal, 10_000 * 100)
            if max_amt < 10_000:
                continue
            amount = rng.randint(50, max_amt // 100) * 100
            channel = rng.choice(["UPI", "IMPS", "NEFT"] if txn_type == "p2p" else ["UPI"])
            location = None

        if balances.get(frm, 0) < amount:
            continue

        ts = start_dt + timedelta(seconds=rng.randint(0, total_sec))
        balances[frm] = balances.get(frm, 0) - amount
        balances[to]  = balances.get(to, 0) + amount
        txns.append({
            "_id": tid(ctr[0]),
            "from": frm, "to": to,
            "amount_paise": amount,
            "ts": fmt_ts(ts),
            "channel": channel,
            "location": location,
            "is_fraud": False,
        })
        ctr[0] += 1
        generated += 1

    return txns


# ─────────────────────────────────────────────────────────────────
# 6b. LEGITIMATE LOOK-ALIKES (hard negatives)
# ─────────────────────────────────────────────────────────────────
#
# Without these, every normal account made a handful of unhurried transfers
# over the whole window and was opened months earlier, so speed or a new
# account alone separated rings from everyone else and the models scored a
# perfect 1.00 on it. Real banks see honest customers who look like mules for
# a moment: money forwarded within minutes, a shop's burst of small payments
# taken out as cash, accounts opened last week. With these in the data the
# models have to learn what actually tells a ring apart.

NEW_ACCOUNT_SHARE = 0.06    # normal accounts opened in the last week
FORWARDER_SHARE   = 0.05    # quick pass-through episodes per account per 30 days
MERCHANT_SHARE    = 0.03    # busy-hour bursts per account per 30 days


def _payer(all_aids, balances, rng, exclude, amount):
    """A normal account that can afford `amount`, or None after a few tries."""
    for _ in range(12):
        a = rng.choice(all_aids)
        if a != exclude and balances.get(a, 0) >= amount:
            return a
    return None


def plan_quick_forward(acc_id, all_aids, balances, rng, at):
    """An honest pass-through: a large transfer in, moved on within minutes
    (rent, a family member, the customer's own account at another bank)."""
    amount = rng.randint(30_000, 600_000) * 100
    sender = _payer(all_aids, balances, rng, acc_id, amount)
    if sender is None:
        return []
    plan = [(at, {"from": sender, "to": acc_id, "amount_paise": amount,
                  "channel": rng.choice(["IMPS", "NEFT", "UPI"]), "location": None})]
    left = (int(amount * rng.uniform(0.85, 0.98)) // 100) * 100
    n_out = rng.randint(1, 3)
    t = at
    for k in range(n_out):
        t = t + timedelta(minutes=rng.randint(3, 40))
        part = left if k == n_out - 1 else (int(left * rng.uniform(0.3, 0.6)) // 100) * 100
        left -= part
        to = rng.choice([a for a in rng.sample(all_aids, 4) if a != acc_id] or [sender])
        if part > 0:
            plan.append((t, {"from": acc_id, "to": to, "amount_paise": part,
                             "channel": rng.choice(["IMPS", "UPI", "NEFT"]), "location": None}))
    return plan


def plan_merchant_burst(acc_id, all_aids, balances, rng, at, home):
    """A shop's busy hour: many small UPI payments in, then most of the
    takings withdrawn as cash near home or sent on to a supplier."""
    plan = []
    t = at
    total = 0
    for _ in range(rng.randint(8, 25)):
        t = t + timedelta(minutes=rng.randint(1, 8))
        amount = rng.randint(50, 3000) * 100
        payer = _payer(all_aids, balances, rng, acc_id, amount)
        if payer is None:
            continue
        plan.append((t, {"from": payer, "to": acc_id, "amount_paise": amount, "channel": "UPI", "location": None}))
        total += amount
    if total < 50_000:
        return plan
    t = t + timedelta(minutes=rng.randint(30, 240))
    out = (int(total * rng.uniform(0.70, 0.95)) // 100) * 100
    if rng.random() < 0.6:
        lat, lng = jitter(home["lat"], home["lng"], rng)
        plan.append((t, {"from": acc_id, "to": CASH, "amount_paise": out, "channel": "ATM",
                         "location": {"city": home["city"], "lat": lat, "lng": lng}}))
    else:
        to = rng.choice([a for a in rng.sample(all_aids, 4) if a != acc_id] or [all_aids[0]])
        plan.append((t, {"from": acc_id, "to": to, "amount_paise": out, "channel": rng.choice(["IMPS", "NEFT"]), "location": None}))
    return plan


def gen_lookalike_txns(accounts, start_dt, days, rng, ctr, balances):
    """The batch generator's look-alikes, spread over the whole window."""
    all_aids = [a["_id"] for a in accounts]
    by_id = {a["_id"]: a for a in accounts}
    span = int(days * 86400)
    n_fwd = int(len(accounts) * FORWARDER_SHARE * days / 30)
    n_mer = int(len(accounts) * MERCHANT_SHARE * days / 30)
    txns = []
    for kind in ["forward"] * n_fwd + ["merchant"] * n_mer:
        acc = rng.choice(all_aids)
        at = start_dt + timedelta(seconds=rng.randint(3600, max(3601, span - 6 * 3600)))
        plan = (plan_quick_forward(acc, all_aids, balances, rng, at) if kind == "forward"
                else plan_merchant_burst(acc, all_aids, balances, rng, at, by_id[acc]["home"]))
        for ts, body in plan:
            balances[body["from"]] = balances.get(body["from"], 0) - body["amount_paise"]
            balances[body["to"]] = balances.get(body["to"], 0) + body["amount_paise"]
            txns.append({"_id": tid(ctr[0]), **body, "ts": fmt_ts(ts), "is_fraud": False})
            ctr[0] += 1
    return txns


# ─────────────────────────────────────────────────────────────────
# 7.  FRAUD RING PATTERN PLANTERS
# ─────────────────────────────────────────────────────────────────

def _atm_cashout(cashout_acc, balances, ctr, ring_start, rng):
    """Common ATM cash-out step: cashout_acc -> CASH."""
    co_bal = balances.get(cashout_acc["_id"], 0)
    if co_bal < 10_000:
        return None
    atm_amt = (int(co_bal * rng.uniform(0.80, 0.99)) // 100) * 100
    atm_ts  = ring_start + timedelta(hours=rng.randint(1, 4))
    other   = rng.choice([c for c in INDIAN_CITIES if c["city"] != cashout_acc["home"]["city"]])
    lat, lng = jitter(other["lat"], other["lng"], rng)
    loc = {"city": other["city"], "lat": lat, "lng": lng}
    t = {
        "_id": tid(ctr[0]),
        "from": cashout_acc["_id"], "to": CASH,
        "amount_paise": atm_amt,
        "ts": fmt_ts(atm_ts),
        "channel": "ATM", "location": loc, "is_fraud": True,
    }
    ctr[0] += 1
    balances[cashout_acc["_id"]] = balances.get(cashout_acc["_id"], 0) - atm_amt
    balances[CASH] = balances.get(CASH, 0) + atm_amt
    return t


def plant_a(ring_id, rng, start_dt, ctr, balances, id_list, offset):
    """Pattern A — Fan-out: Victim→Source→Mules→CashOut."""
    n_mules   = rng.randint(5, 8)
    n_cashout = rng.randint(1, 2)
    n_total   = 1 + n_mules + n_cashout
    ring_accs = make_ring_accounts(n_total, rng, start_dt, offset)
    source    = ring_accs[0]
    mules     = ring_accs[1:1 + n_mules]
    cashouts  = ring_accs[1 + n_mules:]

    # Shared identifiers among first 3
    upsert_identifier(id_list, did(offset + 900), "device",
                      [a["_id"] for a in ring_accs[:3]])
    upsert_identifier(id_list, pid(offset + 900), "phone",
                      [a["_id"] for a in ring_accs[:3]])

    day_off   = rng.randint(1, 3)
    ring_start = start_dt + timedelta(days=day_off,
                                      hours=rng.randint(8, 14),
                                      minutes=rng.randint(0, 45))
    victim_amt  = rng.randint(200_000, 1_200_000) * 100
    victim_acc  = f"VICTIM_{ring_id}"

    for acc in ring_accs:
        balances[acc["_id"]] = acc["opening_balance"]
    balances[source["_id"]] += victim_amt

    # Victim txn
    vtxn = {
        "_id": tid(ctr[0]),
        "from": victim_acc, "to": source["_id"],
        "amount_paise": victim_amt,
        "ts": fmt_ts(ring_start),
        "channel": "IMPS", "location": None, "is_fraud": True,
    }
    victim_txn_id = vtxn["_id"]
    ctr[0] += 1
    new_txns = [vtxn]

    # Fan-out: source → mules
    remaining = victim_amt
    mule_recv = {}
    for i, mule in enumerate(mules):
        if i == len(mules) - 1:
            portion = remaining
        else:
            portion = (int(victim_amt * rng.uniform(0.10, 0.22)) // 100) * 100
            portion = min(portion, remaining - 10_000)
            portion = max(portion, 10_000)
        remaining -= portion
        mule_recv[mule["_id"]] = portion
        hop_ts = ring_start + timedelta(minutes=rng.randint(2, 15) * (i + 1))
        if balances.get(source["_id"], 0) < portion:
            continue
        t = {
            "_id": tid(ctr[0]),
            "from": source["_id"], "to": mule["_id"],
            "amount_paise": portion,
            "ts": fmt_ts(hop_ts),
            "channel": rng.choice(["UPI", "IMPS"]),
            "location": None, "is_fraud": True,
        }
        ctr[0] += 1
        balances[source["_id"]] -= portion
        balances[mule["_id"]]   += portion
        new_txns.append(t)

    # Mules → cashouts
    for i, mule in enumerate(mules):
        co = rng.choice(cashouts)
        mule_amt = mule_recv.get(mule["_id"], 0)
        fwd = (int(mule_amt * rng.uniform(0.90, 0.99)) // 100) * 100
        if balances.get(mule["_id"], 0) < fwd or fwd <= 0:
            continue
        fwd_ts = ring_start + timedelta(minutes=20 + rng.randint(2, 15) * (i + 1))
        t = {
            "_id": tid(ctr[0]),
            "from": mule["_id"], "to": co["_id"],
            "amount_paise": fwd,
            "ts": fmt_ts(fwd_ts),
            "channel": rng.choice(["UPI", "IMPS"]),
            "location": None, "is_fraud": True,
        }
        ctr[0] += 1
        balances[mule["_id"]] -= fwd
        balances[co["_id"]]   += fwd
        new_txns.append(t)

    # Cashouts → CASH
    for co in cashouts:
        t = _atm_cashout(co, balances, ctr, ring_start, rng)
        if t:
            new_txns.append(t)

    member_ids = [a["_id"] for a in ring_accs]
    for acc in ring_accs:
        acc["ring_id"] = ring_id

    gt = {
        "ring_id": ring_id, "pattern": "A",
        "member_ids": member_ids,
        "victim_txn_id": victim_txn_id,
        "victim_amount_paise": victim_amt,
        "victim_account_id": victim_acc,
        "roles": {
            source["_id"]: "source",
            **{m["_id"]: "mule"    for m in mules},
            **{c["_id"]: "cashout" for c in cashouts},
        },
    }
    return ring_accs, new_txns, gt, member_ids, victim_txn_id


def plant_b(ring_id, rng, start_dt, ctr, balances, id_list, offset):
    """Pattern B — Relay Chain: Victim→Source→Relay...→CashOut."""
    n_relays = rng.randint(2, 4)
    n_total  = 1 + n_relays + 1
    ring_accs = make_ring_accounts(n_total, rng, start_dt, offset, days_window=5)
    source   = ring_accs[0]
    relays   = ring_accs[1:1 + n_relays]
    cashout  = ring_accs[-1]

    upsert_identifier(id_list, did(offset + 950), "device",
                      [a["_id"] for a in ring_accs])
    upsert_identifier(id_list, pid(offset + 950), "phone",
                      [a["_id"] for a in ring_accs])

    day_off    = rng.randint(1, 4)
    ring_start = start_dt + timedelta(days=day_off, hours=rng.randint(9, 16))
    victim_amt = rng.randint(100_000, 800_000) * 100
    victim_acc = f"VICTIM_{ring_id}"

    for acc in ring_accs:
        balances[acc["_id"]] = acc["opening_balance"]
    balances[source["_id"]] += victim_amt

    vtxn = {
        "_id": tid(ctr[0]),
        "from": victim_acc, "to": source["_id"],
        "amount_paise": victim_amt,
        "ts": fmt_ts(ring_start),
        "channel": "IMPS", "location": None, "is_fraud": True,
    }
    victim_txn_id = vtxn["_id"]
    ctr[0] += 1
    new_txns = [vtxn]

    cur_acc = source
    cur_amt = victim_amt
    cur_ts  = ring_start

    for next_acc in relays + [cashout]:
        cut     = (int(cur_amt * rng.uniform(0.03, 0.10)) // 100) * 100
        forward = cur_amt - cut
        forward = (forward // 100) * 100
        hop_ts  = cur_ts + timedelta(minutes=rng.randint(2, 15))
        if balances.get(cur_acc["_id"], 0) < forward or forward <= 0:
            break
        t = {
            "_id": tid(ctr[0]),
            "from": cur_acc["_id"], "to": next_acc["_id"],
            "amount_paise": forward,
            "ts": fmt_ts(hop_ts),
            "channel": rng.choice(["UPI", "IMPS"]),
            "location": None, "is_fraud": True,
        }
        ctr[0] += 1
        balances[cur_acc["_id"]]  -= forward
        balances[next_acc["_id"]] = balances.get(next_acc["_id"], 0) + forward
        new_txns.append(t)
        cur_acc, cur_amt, cur_ts = next_acc, forward, hop_ts

    t = _atm_cashout(cashout, balances, ctr, ring_start, rng)
    if t:
        new_txns.append(t)

    member_ids = [a["_id"] for a in ring_accs]
    for acc in ring_accs:
        acc["ring_id"] = ring_id

    gt = {
        "ring_id": ring_id, "pattern": "B",
        "member_ids": member_ids,
        "victim_txn_id": victim_txn_id,
        "victim_amount_paise": victim_amt,
        "victim_account_id": victim_acc,
        "roles": {
            source["_id"]:  "source",
            **{r["_id"]: "relay"   for r in relays},
            cashout["_id"]: "cashout",
        },
    }
    return ring_accs, new_txns, gt, member_ids, victim_txn_id


def plant_c(ring_id, rng, start_dt, ctr, balances, id_list, offset):
    """Pattern C — Shared-Device Cluster: Coordinator + Mules share devices."""
    n_members = rng.randint(8, 10)
    ring_accs = make_ring_accounts(n_members, rng, start_dt, offset, days_window=3)
    coordinator = ring_accs[0]
    mules       = ring_accs[1:-1]
    cashout_acc = ring_accs[-1]

    n_shared_devs = rng.randint(2, 3)
    for i in range(n_shared_devs):
        subset = [coordinator["_id"]] + [m["_id"] for m in mules[i*2:(i+1)*2]]
        upsert_identifier(id_list, did(offset + 970 + i), "device", subset)
    upsert_identifier(id_list, pid(offset + 970), "phone",
                      [coordinator["_id"]] + [m["_id"] for m in mules[:4]])

    day_off    = rng.randint(1, 4)
    ring_start = start_dt + timedelta(days=day_off, hours=rng.randint(8, 20))
    victim_amt = rng.randint(10_000, 50_000) * 100   # C coordinator moves little money
    victim_acc = f"VICTIM_{ring_id}"

    for acc in ring_accs:
        balances[acc["_id"]] = acc["opening_balance"]
    balances[coordinator["_id"]] += victim_amt

    vtxn = {
        "_id": tid(ctr[0]),
        "from": victim_acc, "to": coordinator["_id"],
        "amount_paise": victim_amt,
        "ts": fmt_ts(ring_start),
        "channel": "UPI", "location": None, "is_fraud": True,
    }
    victim_txn_id = vtxn["_id"]
    ctr[0] += 1
    new_txns = [vtxn]

    # Coordinator → mules (burst over 1–2 days)
    for i, mule in enumerate(mules):
        mule_amt = rng.randint(1_000, 20_000) * 100
        if balances.get(coordinator["_id"], 0) < mule_amt:
            balances[coordinator["_id"]] += mule_amt * 2
        coord_ts = ring_start + timedelta(hours=rng.randint(0, 36), minutes=rng.randint(0, 59))
        t = {
            "_id": tid(ctr[0]),
            "from": coordinator["_id"], "to": mule["_id"],
            "amount_paise": mule_amt,
            "ts": fmt_ts(coord_ts),
            "channel": rng.choice(["UPI", "IMPS"]),
            "location": None, "is_fraud": True,
        }
        ctr[0] += 1
        balances[coordinator["_id"]] -= mule_amt
        balances[mule["_id"]]        = balances.get(mule["_id"], 0) + mule_amt
        new_txns.append(t)

    # Mules → cashout
    for mule in mules:
        m_bal = balances.get(mule["_id"], 0)
        if m_bal < 10_000:
            continue
        fwd = (int(m_bal * rng.uniform(0.70, 0.95)) // 100) * 100
        fwd_ts = ring_start + timedelta(hours=rng.randint(24, 48), minutes=rng.randint(0, 59))
        t = {
            "_id": tid(ctr[0]),
            "from": mule["_id"], "to": cashout_acc["_id"],
            "amount_paise": fwd,
            "ts": fmt_ts(fwd_ts),
            "channel": rng.choice(["UPI", "IMPS"]),
            "location": None, "is_fraud": True,
        }
        ctr[0] += 1
        balances[mule["_id"]]          -= fwd
        balances[cashout_acc["_id"]]   = balances.get(cashout_acc["_id"], 0) + fwd
        new_txns.append(t)

    t = _atm_cashout(cashout_acc, balances, ctr, ring_start, rng)
    if t:
        new_txns.append(t)

    member_ids = [a["_id"] for a in ring_accs]
    for acc in ring_accs:
        acc["ring_id"] = ring_id

    gt = {
        "ring_id": ring_id, "pattern": "C",
        "member_ids": member_ids,
        "victim_txn_id": victim_txn_id,
        "victim_amount_paise": victim_amt,
        "victim_account_id": victim_acc,
        "roles": {
            coordinator["_id"]: "coordinator",
            **{m["_id"]: "mule"    for m in mules},
            cashout_acc["_id"]:  "cashout",
        },
    }
    return ring_accs, new_txns, gt, member_ids, victim_txn_id


def plant_d(ring_id, rng, start_dt, ctr, balances, id_list, offset):
    """Pattern D — Scatter-Gather (test-only): Victim→Source→Mules→Collector→CashOut."""
    n_mules  = rng.randint(3, 6)
    n_total  = 1 + n_mules + 1 + 1
    ring_accs = make_ring_accounts(n_total, rng, start_dt, offset, days_window=5)
    source    = ring_accs[0]
    mules     = ring_accs[1:1 + n_mules]
    collector = ring_accs[1 + n_mules]
    cashout   = ring_accs[-1]

    upsert_identifier(id_list, did(offset + 990), "device",
                      [a["_id"] for a in ring_accs[:3]])

    day_off    = rng.randint(1, 3)
    ring_start = start_dt + timedelta(days=day_off, hours=rng.randint(8, 14))
    victim_amt = rng.randint(150_000, 1_000_000) * 100
    victim_acc = f"VICTIM_{ring_id}"

    for acc in ring_accs:
        balances[acc["_id"]] = acc["opening_balance"]
    balances[source["_id"]] += victim_amt

    vtxn = {
        "_id": tid(ctr[0]),
        "from": victim_acc, "to": source["_id"],
        "amount_paise": victim_amt,
        "ts": fmt_ts(ring_start),
        "channel": "IMPS", "location": None, "is_fraud": True,
    }
    victim_txn_id = vtxn["_id"]
    ctr[0] += 1
    new_txns = [vtxn]

    # Fan-out: source → mules
    remaining  = victim_amt
    mule_recv  = {}
    for i, mule in enumerate(mules):
        if i == len(mules) - 1:
            portion = remaining
        else:
            portion = (int(victim_amt * rng.uniform(0.10, 0.28)) // 100) * 100
            portion = min(portion, remaining - 10_000)
            portion = max(portion, 10_000)
        remaining -= portion
        mule_recv[mule["_id"]] = portion
        hop_ts = ring_start + timedelta(minutes=rng.randint(2, 12) * (i + 1))
        if balances.get(source["_id"], 0) < portion:
            continue
        t = {
            "_id": tid(ctr[0]),
            "from": source["_id"], "to": mule["_id"],
            "amount_paise": portion,
            "ts": fmt_ts(hop_ts),
            "channel": rng.choice(["UPI", "IMPS"]),
            "location": None, "is_fraud": True,
        }
        ctr[0] += 1
        balances[source["_id"]] -= portion
        balances[mule["_id"]]   += portion
        new_txns.append(t)

    # Gather: mules → collector
    for i, mule in enumerate(mules):
        m_amt = mule_recv.get(mule["_id"], 0)
        fwd   = (int(m_amt * rng.uniform(0.88, 0.98)) // 100) * 100
        if balances.get(mule["_id"], 0) < fwd or fwd <= 0:
            continue
        gather_ts = ring_start + timedelta(minutes=30 + rng.randint(5, 20) * (i + 1))
        t = {
            "_id": tid(ctr[0]),
            "from": mule["_id"], "to": collector["_id"],
            "amount_paise": fwd,
            "ts": fmt_ts(gather_ts),
            "channel": rng.choice(["UPI", "IMPS"]),
            "location": None, "is_fraud": True,
        }
        ctr[0] += 1
        balances[mule["_id"]]      -= fwd
        balances[collector["_id"]] = balances.get(collector["_id"], 0) + fwd
        new_txns.append(t)

    # Collector → cashout
    col_bal = balances.get(collector["_id"], 0)
    if col_bal >= 10_000:
        fwd    = (int(col_bal * rng.uniform(0.90, 0.99)) // 100) * 100
        fwd_ts = ring_start + timedelta(hours=1, minutes=rng.randint(5, 30))
        t = {
            "_id": tid(ctr[0]),
            "from": collector["_id"], "to": cashout["_id"],
            "amount_paise": fwd,
            "ts": fmt_ts(fwd_ts),
            "channel": rng.choice(["UPI", "IMPS"]),
            "location": None, "is_fraud": True,
        }
        ctr[0] += 1
        balances[collector["_id"]] -= fwd
        balances[cashout["_id"]]   = balances.get(cashout["_id"], 0) + fwd
        new_txns.append(t)

    t = _atm_cashout(cashout, balances, ctr, ring_start, rng)
    if t:
        new_txns.append(t)

    member_ids = [a["_id"] for a in ring_accs]
    for acc in ring_accs:
        acc["ring_id"] = ring_id

    gt = {
        "ring_id": ring_id, "pattern": "D",
        "member_ids": member_ids,
        "victim_txn_id": victim_txn_id,
        "victim_amount_paise": victim_amt,
        "victim_account_id": victim_acc,
        "roles": {
            source["_id"]:    "source",
            **{m["_id"]: "mule"    for m in mules},
            collector["_id"]: "relay",
            cashout["_id"]:   "cashout",
        },
    }
    return ring_accs, new_txns, gt, member_ids, victim_txn_id


# ─────────────────────────────────────────────────────────────────
# 8.  ACCOUNT E
# ─────────────────────────────────────────────────────────────────

def plant_account_e(ring_member_ids, id_list, rng, start_dt, acc_offset):
    """
    Account E: new account, shares a device with a ring member.
    Has NO ring transactions  —  the recruitment candidate.
    """
    e_id = aid(acc_offset)
    opened_at = start_dt - timedelta(days=rng.randint(1, 3))
    home = rand_city(rng)
    acc_e = {
        "_id":             e_id,
        "holder":          rand_name(rng),
        "bank":            rng.choice(BANKS),
        "home":            home,
        "opened_at":       fmt_ts(opened_at),
        "opening_balance": rng.randint(200, 2_000) * 100,
        "features":        {},
        "risk_v1":         0.0,
        "risk_v2":         0.0,
        "signals":         [],
        "ring_id":         None,
        "role":            None,
        "role_reason":     None,
        "is_account_e":    True,
    }
    # Share a device with one ring member
    ring_member = rng.choice(ring_member_ids)
    target = next(
        (r for r in id_list if r["type"] == "device" and ring_member in r["account_ids"]),
        None
    )
    if target:
        if e_id not in target["account_ids"]:
            target["account_ids"].append(e_id)
    else:
        upsert_identifier(id_list, did(acc_offset + 995), "device",
                          [ring_member, e_id])
    return acc_e


# ─────────────────────────────────────────────────────────────────
# 9.  MAIN GENERATOR
# ─────────────────────────────────────────────────────────────────

RING_FNS = {"A": plant_a, "B": plant_b, "C": plant_c, "D": plant_d}


def generate_profile(profile: str):
    cfg        = PROFILE_CONFIG[profile]
    rng        = random.Random(cfg["seed"])
    start_dt   = parse_ts(cfg["start_date"])
    ctr        = [0]
    id_list    = []
    balances   = {}

    print(f"\n[generate] {profile.upper()}  seed={cfg['seed']}")

    # 1. Normal accounts
    print(f"  Making {cfg['n_accounts']} normal accounts...")
    normal_accs = make_accounts(cfg["n_accounts"], rng, start_dt)
    for acc in normal_accs:
        balances[acc["_id"]] = acc["opening_balance"]

    # 2. Fraud rings
    if profile == "demo":
        patterns = ["A", "B", "C"]
    elif profile == "train":
        cycle = ["A", "B", "C"]
        patterns = [cycle[i % 3] for i in range(cfg["n_rings"])]
    else:  # test
        cycle = ["A", "B", "C", "D"]
        patterns = [cycle[i % 4] for i in range(cfg["n_rings"])]

    ring_acc_offset = cfg["n_accounts"] + 100
    all_ring_accs   = []
    all_ring_txns   = []
    all_gt          = []
    first_ring_members = []

    print(f"  Planting {len(patterns)} rings ({', '.join(sorted(set(patterns)))})...")
    for idx, pat in enumerate(patterns):
        ring_id = f"RING{idx+1:02d}"
        offset  = ring_acc_offset + idx * 30
        fn      = RING_FNS[pat]
        raccs, rtxns, gt, mids, _ = fn(ring_id, rng, start_dt, ctr, balances, id_list, offset)
        all_ring_accs.extend(raccs)
        all_ring_txns.extend(rtxns)
        all_gt.append(gt)
        if idx == 0:
            first_ring_members = mids

    # 3. Account E
    acc_e = None
    if cfg.get("account_e") and first_ring_members:
        e_offset = cfg["n_accounts"] + len(patterns) * 30 + 200
        acc_e = plant_account_e(first_ring_members, id_list, rng, start_dt, e_offset)
        print(f"  Account E: {acc_e['_id']}")

    # 4. Everyday identifiers: a device, a phone and an IP for every account,
    # ring members and Account E included. Ring members used to get only the
    # ring's shared device or phone and never an IP, while every normal
    # account had all three, so "has no IP on record" alone picked out the
    # rings and the models scored 1.00 on that rather than on behaviour.
    # Rings are still told apart by what they share (step 2), not by what
    # they lack.
    n_devs   = max(50, cfg["n_accounts"] // 5)
    n_phones = max(50, cfg["n_accounts"] // 5)
    n_ips    = max(30, cfg["n_accounts"] // 8)
    everyone = normal_accs + all_ring_accs + ([acc_e] if acc_e else [])
    normal_id_list = assign_normal_identifiers(
        everyone, rng, n_devs, n_phones, n_ips, share_rate=0.04
    )
    # Merge: ring identifiers take precedence
    ring_id_keys = {r["_id"] for r in id_list}
    for rec in normal_id_list:
        if rec["_id"] not in ring_id_keys:
            id_list.append(rec)

    # 5. Normal transactions
    print(f"  Generating {cfg['n_normal_txns']} normal transactions...")
    balances["SALARY"] = 10**15
    balances[CASH]     = 0
    # Ring members are people too: they draw a salary and make ordinary
    # transfers like everyone else, around the fraud. Without this a ring
    # account existed only for the hours of its cascade, which made "all of
    # this account's activity is in one burst" a perfect fraud label.
    normal_txns = gen_normal_txns(
        everyone, cfg["n_normal_txns"], start_dt,
        cfg["days"], rng, ctr, balances
    )
    # 5b. Honest customers who look like mules for a moment (section 6b).
    lookalike_txns = gen_lookalike_txns(normal_accs, start_dt, cfg["days"], rng, ctr, balances)
    print(f"  Added {len(lookalike_txns)} look-alike transactions (quick forwards, merchant bursts).")
    normal_txns = normal_txns + lookalike_txns

    # 6. Assemble all accounts + transactions
    all_accs = normal_accs + all_ring_accs
    if acc_e:
        all_accs.append(acc_e)

    all_txns = normal_txns + all_ring_txns
    all_txns.sort(key=lambda t: t["ts"])

    # 7. Re-assign sequential IDs and patch ground_truth references
    old_to_new = {}
    for new_i, txn in enumerate(all_txns):
        old_to_new[txn["_id"]] = tid(new_i)
        txn["_id"] = tid(new_i)

    for gt in all_gt:
        old_vid = gt["victim_txn_id"]
        gt["victim_txn_id"] = old_to_new.get(old_vid, old_vid)

    # 8. Validate no negative balances (skip external pseudo-accounts)
    skip_prefixes = ("VICTIM_", "SALARY")
    skip_exact = {CASH}
    sim_bal = {a["_id"]: a["opening_balance"] for a in all_accs}
    sim_bal["SALARY"] = 10**15
    sim_bal[CASH]     = 0
    neg_events = []
    for txn in all_txns:
        frm, to, amt = txn["from"], txn["to"], txn["amount_paise"]
        sim_bal[frm] = sim_bal.get(frm, 0) - amt
        sim_bal[to]  = sim_bal.get(to, 0) + amt
        is_external = (frm in skip_exact or
                       any(frm.startswith(p) for p in skip_prefixes))
        if not is_external and sim_bal.get(frm, 0) < 0:
            neg_events.append((frm, sim_bal[frm], txn["_id"]))

    # Filter: only count unique accounts once (worst violation)
    seen = {}
    for frm, b, t in neg_events:
        if frm not in seen or b < seen[frm][0]:
            seen[frm] = (b, t)
    neg_unique = [(f, b, t) for f, (b, t) in seen.items()]

    if neg_unique:
        # Auto-repair: bump opening_balance of affected accounts to cover shortfall.
        # This keeps the invariant: no balance goes below zero.
        acc_by_id = {a["_id"]: a for a in all_accs}
        for frm, worst_bal, _ in neg_unique:
            deficit = -worst_bal  # positive amount needed
            if frm in acc_by_id:
                acc_by_id[frm]["opening_balance"] += deficit + 100   # +1 paise margin
        # Re-validate after repair
        sim_bal2 = {a["_id"]: a["opening_balance"] for a in all_accs}
        sim_bal2["SALARY"] = 10**15
        sim_bal2[CASH]     = 0
        still_neg = []
        for txn in all_txns:
            frm, to, amt = txn["from"], txn["to"], txn["amount_paise"]
            sim_bal2[frm] = sim_bal2.get(frm, 0) - amt
            sim_bal2[to]  = sim_bal2.get(to, 0) + amt
            is_ext = (frm in skip_exact or any(frm.startswith(p) for p in skip_prefixes))
            if not is_ext and sim_bal2.get(frm, 0) < 0:
                still_neg.append(frm)
        if still_neg:
            print(f"  WARNING: {len(set(still_neg))} accounts still negative after repair.")
        else:
            print(f"  OK: Auto-repaired {len(neg_unique)} opening balances — no negatives remain.")
    else:
        print("  OK: No negative balances.")

    # Add 'amount' (rupees) to every transaction alongside 'amount_paise'
    for txn in all_txns:
        if 'amount' not in txn:
            txn['amount'] = max(0, txn.get('amount_paise', 0) // 100)

    # 9. Write output (both in ml/data and repo root data/)
    ml_out_dir = Path(__file__).resolve().parent / 'data' / profile
    root_out_dir = Path(__file__).resolve().parent.parent / 'data' / profile

    ml_out_dir.mkdir(parents=True, exist_ok=True)
    root_out_dir.mkdir(parents=True, exist_ok=True)

    # ML internal data (keeps both amount and amount_paise)
    with open(ml_out_dir / 'accounts.json', 'w', encoding='utf-8') as f:
        json.dump(all_accs, f, indent=2, ensure_ascii=False)
    with open(ml_out_dir / 'identifiers.json', 'w', encoding='utf-8') as f:
        json.dump(id_list, f, indent=2, ensure_ascii=False)
    with open(ml_out_dir / 'transactions.json', 'w', encoding='utf-8') as f:
        json.dump(all_txns, f, indent=2, ensure_ascii=False)
    with open(ml_out_dir / 'ground_truth.json', 'w', encoding='utf-8') as f:
        json.dump(all_gt, f, indent=2, ensure_ascii=False)

    # Repo root data (Server seeder format: rupees, clean channels, no SALARY)
    valid_channels = {'UPI', 'IMPS', 'NEFT', 'ATM'}
    clean_txns = []
    for t in all_txns:
        frm = t.get('from', '')
        if frm == 'SALARY' or frm.startswith('SALARY'):
            continue
        ch = t.get('channel', 'UPI')
        if ch not in valid_channels:
            ch = 'NEFT'
        amt = t.get('amount', t.get('amount_paise', 0) // 100)
        clean_txns.append({
            '_id': t['_id'],
            'from': frm,
            'to': t['to'],
            'amount': amt,
            'ts': t['ts'],
            'channel': ch,
            'location': t.get('location') if ch == 'ATM' else None,
            'is_fraud': bool(t.get('is_fraud', False)),
        })

    clean_accs = []
    for a in all_accs:
        bal = a.get('opening_balance', 0)
        bal_rupees = bal // 100 if bal > 5_000_000 else bal
        clean_accs.append({
            **a,
            'opening_balance': bal_rupees,
        })

    with open(root_out_dir / 'accounts.json', 'w', encoding='utf-8') as f:
        json.dump(clean_accs, f, indent=2, ensure_ascii=False)
    with open(root_out_dir / 'identifiers.json', 'w', encoding='utf-8') as f:
        json.dump(id_list, f, indent=2, ensure_ascii=False)
    with open(root_out_dir / 'transactions.json', 'w', encoding='utf-8') as f:
        json.dump(clean_txns, f, indent=2, ensure_ascii=False)
    with open(root_out_dir / 'ground_truth.json', 'w', encoding='utf-8') as f:
        json.dump(all_gt, f, indent=2, ensure_ascii=False)

    fraud_ids  = {m for gt in all_gt for m in gt["member_ids"]}
    fraud_txns = sum(1 for t in all_txns if t.get("is_fraud"))
    print(f"\n  DONE:  {profile.upper()}: {len(all_accs):,} accounts | "
          f"{len(all_txns):,} txns | "
          f"{len(all_gt)} rings | "
          f"{len(fraud_ids)} fraud accs | {fraud_txns} fraud txns")


# ─────────────────────────────────────────────────────────────────
# 10.  CLI
# ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Chakravyuh data generator")
    ap.add_argument("--profile", choices=["demo", "train", "test"])
    ap.add_argument("--all",     action="store_true")
    args = ap.parse_args()

    if args.all:
        for p in ["train", "test", "demo"]:
            generate_profile(p)
    elif args.profile:
        generate_profile(args.profile)
    else:
        ap.print_help()