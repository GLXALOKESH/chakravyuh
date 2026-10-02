"""
Synthetic Financial Dataset Generator
Generates realistic transaction + identity data with embedded fraud networks
"""

import pandas as pd
import numpy as np
from faker import Faker
import random
from datetime import datetime, timedelta
import json
import os

fake = Faker()
Faker.seed(42)
np.random.seed(42)
random.seed(42)

# ─── Config ───────────────────────────────────────────────────────────────────
N_CUSTOMERS     = 800
N_ACCOUNTS      = 1000
N_TRANSACTIONS  = 20000
N_DEVICES       = 600
N_IPS           = 400
N_PHONES        = 700
N_MERCHANTS     = 150
START_DATE      = datetime(2024, 1, 1)
END_DATE        = datetime(2024, 6, 30)

# Fraud ring sizes
FRAUD_RINGS = [
    {"size": 12, "type": "money_mule"},
    {"size": 8,  "type": "carousel"},
    {"size": 15, "type": "account_takeover"},
    {"size": 6,  "type": "bust_out"},
    {"size": 10, "type": "synthetic_id"},
]

CITIES = [
    ("New York",     40.7128,  -74.0060),
    ("Los Angeles",  34.0522, -118.2437),
    ("Chicago",      41.8781,  -87.6298),
    ("Houston",      29.7604,  -95.3698),
    ("Phoenix",      33.4484, -112.0740),
    ("Philadelphia", 39.9526,  -75.1652),
    ("San Antonio",  29.4241,  -98.4936),
    ("San Diego",    32.7157, -117.1611),
    ("Dallas",       32.7767,  -96.7970),
    ("Miami",        25.7617,  -80.1918),
    ("Seattle",      47.6062, -122.3321),
    ("Denver",       39.7392, -104.9903),
    ("Atlanta",      33.7490,  -84.3880),
    ("Boston",       42.3601,  -71.0589),
    ("Las Vegas",    36.1699, -115.1398),
]

TRANSACTION_TYPES = [
    "transfer", "payment", "withdrawal", "deposit",
    "wire_transfer", "ach", "p2p", "refund"
]

# ─── ID pools ─────────────────────────────────────────────────────────────────
def gen_ids(prefix, n):
    return [f"{prefix}{str(i).zfill(6)}" for i in range(1, n + 1)]

customer_ids  = gen_ids("CUST", N_CUSTOMERS)
account_ids   = gen_ids("ACC",  N_ACCOUNTS)
device_ids    = gen_ids("DEV",  N_DEVICES)
ip_ids        = gen_ids("IP",   N_IPS)
phone_ids     = gen_ids("PH",   N_PHONES)
merchant_ids  = gen_ids("MERCH", N_MERCHANTS)

# ─── Customers ────────────────────────────────────────────────────────────────
def generate_customers():
    rows = []
    for cid in customer_ids:
        city, lat, lon = random.choice(CITIES)
        rows.append({
            "customer_id":  cid,
            "name":         fake.name(),
            "email":        fake.email(),
            "dob":          fake.date_of_birth(minimum_age=18, maximum_age=75).isoformat(),
            "city":         city,
            "state":        fake.state_abbr(),
            "zip":          fake.zipcode(),
            "lat":          lat + np.random.uniform(-1, 1),
            "lon":          lon + np.random.uniform(-1, 1),
            "created_date": fake.date_between(start_date="-5y", end_date="-1y").isoformat(),
            "is_fraud":     False,
        })
    return pd.DataFrame(rows)

# ─── Accounts ─────────────────────────────────────────────────────────────────
def generate_accounts(customers_df):
    rows = []
    customer_pool = customers_df["customer_id"].tolist()
    for aid in account_ids:
        age_days   = random.randint(30, 1800)
        created_dt = END_DATE - timedelta(days=age_days)
        rows.append({
            "account_id":    aid,
            "customer_id":   random.choice(customer_pool),
            "account_type":  random.choice(["checking", "savings", "business", "prepaid"]),
            "balance":       round(random.uniform(100, 50000), 2),
            "created_date":  created_dt.date().isoformat(),
            "age_days":      age_days,
            "status":        "active",
            "is_fraud":      False,
        })
    return pd.DataFrame(rows)

# ─── Identity links ───────────────────────────────────────────────────────────
def generate_identity_links(accounts_df):
    acc_list = accounts_df["account_id"].tolist()
    links = []

    # Account ↔ Device  (some accounts share devices)
    for aid in acc_list:
        n_dev = random.choices([1, 2, 3], weights=[0.75, 0.20, 0.05])[0]
        for _ in range(n_dev):
            links.append({"account_id": aid, "entity_type": "device",
                          "entity_id": random.choice(device_ids)})

    # Account ↔ IP
    for aid in acc_list:
        n_ip = random.choices([1, 2, 3], weights=[0.70, 0.25, 0.05])[0]
        for _ in range(n_ip):
            links.append({"account_id": aid, "entity_type": "ip",
                          "entity_id": random.choice(ip_ids)})

    # Account ↔ Phone
    for aid in acc_list:
        links.append({"account_id": aid, "entity_type": "phone",
                      "entity_id": random.choice(phone_ids)})

    return pd.DataFrame(links).drop_duplicates()

# ─── Normal transactions ──────────────────────────────────────────────────────
def random_timestamp():
    delta = END_DATE - START_DATE
    return START_DATE + timedelta(seconds=random.randint(0, int(delta.total_seconds())))

def generate_normal_transactions(accounts_df, n=N_TRANSACTIONS):
    acc_list = accounts_df["account_id"].tolist()
    rows = []
    for i in range(n):
        src = random.choice(acc_list)
        dst = random.choice([a for a in acc_list if a != src])
        city, lat, lon = random.choice(CITIES)
        ts  = random_timestamp()
        rows.append({
            "transaction_id":   f"TXN{str(i).zfill(8)}",
            "source_account":   src,
            "dest_account":     dst,
            "amount":           round(np.random.lognormal(mean=4.5, sigma=1.2), 2),
            "timestamp":        ts.isoformat(),
            "transaction_type": random.choice(TRANSACTION_TYPES),
            "merchant_id":      random.choice(merchant_ids) if random.random() < 0.4 else None,
            "city":             city,
            "lat":              lat + np.random.uniform(-0.5, 0.5),
            "lon":              lon + np.random.uniform(-0.5, 0.5),
            "is_fraud":         False,
            "fraud_type":       None,
            "ring_id":          None,
        })
    return pd.DataFrame(rows)

# ─── Fraud rings ──────────────────────────────────────────────────────────────
def inject_fraud_ring(ring_cfg, ring_idx, accounts_df, identity_links_df, txn_counter):
    """Inject a fraud ring into existing data."""
    size      = ring_cfg["size"]
    ftype     = ring_cfg["type"]
    acc_list  = accounts_df["account_id"].tolist()
    ring_accs = random.sample(acc_list, min(size, len(acc_list)))

    # Mark accounts as fraudulent
    accounts_df.loc[accounts_df["account_id"].isin(ring_accs), "is_fraud"] = True
    accounts_df.loc[accounts_df["account_id"].isin(ring_accs), "fraud_type"] = ftype
    accounts_df.loc[accounts_df["account_id"].isin(ring_accs), "ring_id"] = f"RING{ring_idx:02d}"

    new_txns  = []
    new_links = []

    # Shared infrastructure (devices / IPs)
    shared_device = random.choice(device_ids)
    shared_ip     = random.choice(ip_ids)
    for aid in ring_accs[:max(2, size // 2)]:
        new_links.append({"account_id": aid, "entity_type": "device", "entity_id": shared_device})
        new_links.append({"account_id": aid, "entity_type": "ip",     "entity_id": shared_ip})

    # Burst transactions within a short window
    burst_start = random_timestamp()
    city, lat, lon = random.choice(CITIES)

    if ftype == "money_mule":
        # Linear chain: A → B → C → … → Z (cash-out)
        for i in range(len(ring_accs) - 1):
            for _ in range(random.randint(2, 5)):
                ts = burst_start + timedelta(minutes=random.randint(0, 120))
                new_txns.append({
                    "transaction_id":   f"TXN{str(txn_counter[0]).zfill(8)}",
                    "source_account":   ring_accs[i],
                    "dest_account":     ring_accs[i + 1],
                    "amount":           round(random.uniform(500, 9500), 2),
                    "timestamp":        ts.isoformat(),
                    "transaction_type": "transfer",
                    "merchant_id":      None,
                    "city":             city,
                    "lat":              lat + np.random.uniform(-0.1, 0.1),
                    "lon":              lon + np.random.uniform(-0.1, 0.1),
                    "is_fraud":         True,
                    "fraud_type":       ftype,
                    "ring_id":          f"RING{ring_idx:02d}",
                })
                txn_counter[0] += 1

    elif ftype == "carousel":
        # Round-robin cycling of funds
        for _ in range(30):
            i   = random.randint(0, len(ring_accs) - 1)
            j   = (i + random.randint(1, 3)) % len(ring_accs)
            ts  = burst_start + timedelta(minutes=random.randint(0, 60))
            new_txns.append({
                "transaction_id":   f"TXN{str(txn_counter[0]).zfill(8)}",
                "source_account":   ring_accs[i],
                "dest_account":     ring_accs[j],
                "amount":           round(random.uniform(1000, 8000), 2),
                "timestamp":        ts.isoformat(),
                "transaction_type": "transfer",
                "merchant_id":      None,
                "city":             city,
                "lat":              lat + np.random.uniform(-0.1, 0.1),
                "lon":              lon + np.random.uniform(-0.1, 0.1),
                "is_fraud":         True,
                "fraud_type":       ftype,
                "ring_id":          f"RING{ring_idx:02d}",
            })
            txn_counter[0] += 1

    elif ftype in ("account_takeover", "synthetic_id", "bust_out"):
        # Star topology: coordinator → mules
        coordinator = ring_accs[0]
        for mule in ring_accs[1:]:
            for _ in range(random.randint(3, 8)):
                ts = burst_start + timedelta(minutes=random.randint(0, 30))
                new_txns.append({
                    "transaction_id":   f"TXN{str(txn_counter[0]).zfill(8)}",
                    "source_account":   coordinator,
                    "dest_account":     mule,
                    "amount":           round(random.uniform(200, 5000), 2),
                    "timestamp":        ts.isoformat(),
                    "transaction_type": random.choice(["transfer", "p2p", "wire_transfer"]),
                    "merchant_id":      None,
                    "city":             city,
                    "lat":              lat + np.random.uniform(-0.2, 0.2),
                    "lon":              lon + np.random.uniform(-0.2, 0.2),
                    "is_fraud":         True,
                    "fraud_type":       ftype,
                    "ring_id":          f"RING{ring_idx:02d}",
                })
                txn_counter[0] += 1

    return new_txns, new_links

# ─── Main generator ───────────────────────────────────────────────────────────
def generate_all(save_path="data"):
    os.makedirs(save_path, exist_ok=True)
    print("Generating customers...")
    customers_df = generate_customers()

    print("Generating accounts...")
    accounts_df  = generate_accounts(customers_df)
    # Extra columns for fraud labelling
    accounts_df["fraud_type"] = None
    accounts_df["ring_id"]    = None

    print("Generating identity links...")
    identity_links_df = generate_identity_links(accounts_df)

    print("Generating normal transactions...")
    txn_counter = [N_TRANSACTIONS]
    txns_df     = generate_normal_transactions(accounts_df)

    print("Injecting fraud rings...")
    all_fraud_txns  = []
    all_fraud_links = []
    for idx, ring in enumerate(FRAUD_RINGS, 1):
        new_txns, new_links = inject_fraud_ring(
            ring, idx, accounts_df, identity_links_df, txn_counter
        )
        all_fraud_txns.extend(new_txns)
        all_fraud_links.extend(new_links)

    fraud_txns_df  = pd.DataFrame(all_fraud_txns)
    fraud_links_df = pd.DataFrame(all_fraud_links)

    txns_df = pd.concat([txns_df, fraud_txns_df], ignore_index=True)
    txns_df["timestamp"] = pd.to_datetime(txns_df["timestamp"])
    txns_df = txns_df.sort_values("timestamp").reset_index(drop=True)

    identity_links_df = pd.concat([identity_links_df, fraud_links_df],
                                   ignore_index=True).drop_duplicates()

    # Save
    customers_df.to_csv(f"{save_path}/customers.csv", index=False)
    accounts_df.to_csv(f"{save_path}/accounts.csv", index=False)
    identity_links_df.to_csv(f"{save_path}/identity_links.csv", index=False)
    txns_df.to_csv(f"{save_path}/transactions.csv", index=False)

    stats = {
        "n_customers":        len(customers_df),
        "n_accounts":         len(accounts_df),
        "n_transactions":     len(txns_df),
        "n_fraud_accounts":   int(accounts_df["is_fraud"].sum()),
        "n_fraud_txns":       int(txns_df["is_fraud"].sum()),
        "n_identity_links":   len(identity_links_df),
        "fraud_rings":        len(FRAUD_RINGS),
    }
    with open(f"{save_path}/stats.json", "w") as f:
        json.dump(stats, f, indent=2)

    print("\n[OK] Dataset generated:")
    for k, v in stats.items():
        print(f"   {k}: {v}")
    return customers_df, accounts_df, identity_links_df, txns_df

if __name__ == "__main__":
    generate_all()
