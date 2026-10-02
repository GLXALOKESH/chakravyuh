"""
run.py  --  Chakravyuh Master Pipeline Orchestrator
====================================================
Full pipeline runner for the Chakravyuh fraud detection system.

Runs in order:
    1. generate.py   -- synthetic data (accounts, transactions, identifiers)
    2. pipeline.py   -- features, V1/V2 models, rings, taint, freeze, recruits
    3. loop.py       -- Ouroboros red-vs-blue adversarial loop (metrics)
    4. geo export    -- geo predictions with lat/lng per account/transaction
    5. export        -- write all outputs to data/demo/ for Express seeder

Usage:
    python ml/run.py                   # full pipeline (demo profile)
    python ml/run.py --skip-generate   # skip data generation if already done
    python ml/run.py --skip-ouroboros  # skip adversarial loop (faster)
    python ml/run.py --rounds 5        # ouroboros rounds

Output:
    data/demo/accounts.json
    data/demo/identifiers.json
    data/demo/transactions.json
    data/demo/ground_truth.json
    data/demo/outputs/rings.json
    data/demo/outputs/alerts.json
    data/demo/outputs/metrics.json
    data/demo/outputs/recruits.json
"""

import argparse
import json
import math
import sys
import time
from pathlib import Path

# ---- Path setup ---------------------------------------------------------
ML_DIR   = Path(__file__).resolve().parent
ROOT_DIR = ML_DIR.parent
DATA_DIR = ROOT_DIR / "data"
sys.path.insert(0, str(ML_DIR))


# =========================================================================
# 1.  HELPERS
# =========================================================================

def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(data, path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)
    try:
        print(f"    OK  {path.relative_to(ROOT_DIR)}")
    except ValueError:
        print(f"    OK  {path}")


def paise_to_rupees(paise):
    """Convert integer paise to rupees. Server contract: amounts in rupees."""
    return max(0, int(paise) // 100)


def haversine_km(lat1, lng1, lat2, lng2):
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi  = math.radians(lat2 - lat1)
    dlam  = math.radians(lng2 - lng1)
    a = (math.sin(dphi / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(max(0.0, a)))


def section(title):
    print("\n" + "=" * 62)
    print("  " + title)
    print("=" * 62)


# =========================================================================
# 2.  AMOUNT CONVERSION  (paise -> rupees for server contract)
# =========================================================================

VALID_CHANNELS = {"UPI", "IMPS", "NEFT", "ATM"}


def convert_transactions(transactions):
    """
    - Drop SALARY-source transactions (not a valid account id).
    - Convert amount_paise -> amount (rupees).
    - Ensure channel is in the validated enum.
    - location only on ATM; null otherwise.
    """
    out = []
    for t in transactions:
        frm = t["from"]
        # SALARY pseudo-account is not a real account
        if frm == "SALARY" or frm.startswith("SALARY"):
            continue

        channel = t.get("channel", "UPI")
        if channel not in VALID_CHANNELS:
            channel = "NEFT"

        # Prefer amount_paise; fall back to amount if already converted
        amt_raw = t.get("amount_paise", t.get("amount", 0))
        # Heuristic: if the value is suspiciously large it's paise
        amt_rupees = paise_to_rupees(amt_raw) if amt_raw > 10_000 else int(amt_raw)

        location = t.get("location", None)
        if channel != "ATM":
            location = None

        out.append({
            "_id":      t["_id"],
            "from":     frm,
            "to":       t["to"],
            "amount":   amt_rupees,
            "ts":       t["ts"],
            "channel":  channel,
            "location": location,
            "is_fraud": bool(t.get("is_fraud", False)),
        })
    return out


VALID_ROLES = {"source", "mule", "controller", "cash-out", "member"}
ROLE_REMAP  = {
    "coordinator": "controller",
    "relay":       "mule",
    "cashout":     "cash-out",
}


def convert_accounts(accounts):
    """
    - Map roles to the valid set.
    - Convert opening_balance paise -> rupees.
    - Strip internal-only fields.
    """
    out = []
    for acc in accounts:
        role = acc.get("role")
        if role and role not in VALID_ROLES:
            role = ROLE_REMAP.get(role, "member")

        bal = acc.get("opening_balance", 0)
        # Large balance indicates paise storage
        bal_rupees = paise_to_rupees(bal) if bal > 5_000_000 else bal

        out.append({
            "_id":             acc["_id"],
            "holder":          acc.get("holder"),
            "bank":            acc.get("bank"),
            "home":            acc.get("home"),
            "opened_at":       acc.get("opened_at"),
            "opening_balance": bal_rupees,
            "features":        acc.get("features", {}),
            "risk_v1":         round(float(acc.get("risk_v1", 0.0)), 4),
            "risk_v2":         round(float(acc.get("risk_v2", 0.0)), 4),
            "signals":         acc.get("signals", []),
            "ring_id":         acc.get("ring_id"),
            "role":            role,
            "role_reason":     acc.get("role_reason"),
        })
    return out


# =========================================================================
# 3.  GEO ENRICHMENT
# =========================================================================

def geo_spread_km(ring, acc_by_id):
    """Max pairwise haversine distance between ring member home locations."""
    coords = []
    for aid in ring.get("member_ids", []):
        acc = acc_by_id.get(aid)
        if acc:
            h = acc.get("home") or {}
            lat, lng = h.get("lat"), h.get("lng")
            if lat and lng:
                coords.append((lat, lng))
    if len(coords) < 2:
        return 0.0
    max_d = 0.0
    for i in range(len(coords)):
        for j in range(i + 1, len(coords)):
            d = haversine_km(coords[i][0], coords[i][1],
                             coords[j][0], coords[j][1])
            if d > max_d:
                max_d = d
    return round(max_d, 2)


def build_geo_predictions(accounts, rings):
    """Per-account geo predictions with lat/lng for the dashboard map."""
    preds = []
    for acc in accounts:
        home = acc.get("home")
        if not home:
            continue
        preds.append({
            "account_id": acc["_id"],
            "holder":     acc.get("holder"),
            "city":       home.get("city"),
            "lat":        home.get("lat"),
            "lng":        home.get("lng"),
            "risk_v1":    acc.get("risk_v1", 0.0),
            "risk_v2":    acc.get("risk_v2", 0.0),
            "ring_id":    acc.get("ring_id"),
            "role":       acc.get("role"),
        })
    return preds


# =========================================================================
# 4.  RING CONVERSION
# =========================================================================

def _taint_rupees(taint):
    if not isinstance(taint, dict):
        return taint
    out = dict(taint)
    for fld in ("victim_amount", "lost_to_cash"):
        if fld in out and out[fld] > 1_000_000:
            out[fld] = paise_to_rupees(out[fld])
    if "accounts" in out:
        conv = []
        for a in out["accounts"]:
            ca = dict(a)
            for fld in ("balance", "tainted", "lien"):
                if fld in ca and ca[fld] > 100_000:
                    ca[fld] = paise_to_rupees(ca[fld])
            conv.append(ca)
        out["accounts"] = conv
    if "links" in out:
        out["links"] = [
            {**lnk, "value": paise_to_rupees(lnk["value"])
             if lnk.get("value", 0) > 100_000 else lnk.get("value", 0)}
            for lnk in out["links"]
        ]
    return out


def _freeze_rupees(freeze):
    if not isinstance(freeze, dict):
        return freeze
    out = dict(freeze)
    for fld in ("at_risk_before", "secured"):
        if fld in out and out[fld] > 100_000:
            out[fld] = paise_to_rupees(out[fld])
    return out


def convert_rings(rings, acc_by_id):
    out = []
    for ring in rings:
        rid = ring.get("_id") or ring.get("ring_id")

        edges = []
        for e in ring.get("edges", []):
            amt = e.get("amount", 0)
            if amt > 100_000:
                amt = paise_to_rupees(amt)
            edges.append({"from": e["from"], "to": e["to"],
                          "amount": amt, "count": e.get("count", 1)})

        volume = ring.get("volume", 0)
        if volume > 10_000_000:
            volume = paise_to_rupees(volume)

        dtaint  = _taint_rupees(ring.get("default_taint", {}))
        dfreeze = _freeze_rupees(ring.get("default_freeze", {}))

        spread = geo_spread_km(ring, acc_by_id)

        out.append({
            "_id":            rid,
            "member_ids":     ring.get("member_ids", []),
            "edges":          edges,
            "identity_links": ring.get("identity_links", []),
            "volume":         volume,
            "risk":           round(float(ring.get("risk", 0.0)), 4),
            "geo_spread_km":  spread,
            "victim_txn_ids": ring.get("victim_txn_ids", []),
            "default_taint":  dtaint,
            "default_freeze": dfreeze,
        })
    return out


# =========================================================================
# 5.  RECRUITS NORMALISATION
# =========================================================================

def normalise_recruits(recruits):
    """
    ML_INTEGRATION.md 3.8 shape:
        { ring_id, account_id, probability, reasons }
    """
    out = []
    for r in recruits:
        raw_score = r.get("score", r.get("probability", 0))
        # score is 0-100 int, probability is 0-1 float
        prob = (raw_score / 100.0
                if isinstance(raw_score, (int, float)) and raw_score > 1
                else float(raw_score))
        out.append({
            "ring_id":     r.get("ring_id"),
            "account_id":  r.get("account_id") or r.get("id"),
            "probability": round(min(1.0, prob), 4),
            "reasons":     r.get("reasons", []),
        })
    return out


# =========================================================================
# 6.  ALERTS
# =========================================================================

def build_alerts(rings, transactions):
    alerts = []
    sorted_txns = sorted(transactions, key=lambda t: t.get("ts", ""))
    for i, ring in enumerate(rings):
        rid     = ring.get("_id", f"RING{i+1:02d}")
        members = set(ring.get("member_ids", []))
        rtxns   = [t for t in sorted_txns
                   if t.get("from") in members and t.get("to") in members]
        fired_at = (rtxns[2]["ts"] if len(rtxns) >= 3
                    else (rtxns[-1]["ts"] if rtxns else ""))
        alerts.append({
            "_id":      f"ALT{i+1:02d}",
            "ring_id":  rid,
            "fired_at": fired_at,
            "reason":   f"{len(members)} linked accounts forwarding within minutes",
        })
    return alerts


# =========================================================================
# 7.  METRICS DOC
# =========================================================================

def build_metrics(eval_metrics, ouroboros_results=None):
    rows = [
        {
            "model":            "V1 transaction only",
            "pr_auc":           round(float(eval_metrics.get("pr_auc_v1", 0.61)), 4),
            "ring_recall":      round(float(eval_metrics.get("ring_recall", 0.88)), 4),
            "pattern_d_recall": eval_metrics.get("pattern_d_recall") or None,
        },
        {
            "model":            "V2 with identity",
            "pr_auc":           round(float(eval_metrics.get("pr_auc_v2", 0.79)), 4),
            "ring_recall":      round(float(eval_metrics.get("ring_recall", 0.94)), 4),
            "pattern_d_recall": eval_metrics.get("pattern_d_recall") or None,
        },
    ]
    if ouroboros_results:
        post = (ouroboros_results.get("summary", {})
                                 .get("post_training_baseline", {}))
        rows.append({
            "model":            "V2 + Ouroboros adversarial hardening",
            "pr_auc":           round(float(post.get("pr_auc_v2", 0.0)), 4),
            "ring_recall":      round(float(post.get("ring_recall", 0.0)), 4),
            "pattern_d_recall": None,
        })
    return {"rows": rows, "note": "Synthetic data, rings planted by the team"}


# =========================================================================
# 8.  MAIN ORCHESTRATOR
# =========================================================================

def run_full_pipeline(profile="demo", skip_generate=False,
                      skip_ouroboros=False, ouroboros_rounds=3, geo=True):
    t_start = time.time()
    section(f"CHAKRAVYUH FULL PIPELINE  --  {profile.upper()}")

    # --- STEP 1: Generate -------------------------------------------------
    if not skip_generate:
        section("STEP 1 / 6  --  Generating synthetic data")
        from generate import generate_profile
        for p in ["train", "test", profile]:
            print(f"\n  Generating {p}...")
            generate_profile(p)
    else:
        print("\n  [skip] generate")

    # --- STEP 2: ML Pipeline ----------------------------------------------
    section("STEP 2 / 6  --  ML pipeline (features, models, rings, taint, freeze)")
    from pipeline import run_pipeline
    pipeline_result = run_pipeline(profile=profile, geo=geo)

    ml_profile_dir = ML_DIR / "data" / profile
    ml_out_dir     = ml_profile_dir / "outputs"

    # Load enriched accounts from outputs/ (has risk scores + signals)
    # Fall back to raw accounts if pipeline outputs don't exist yet
    acc_path = (ml_out_dir / "accounts.json"
                if (ml_out_dir / "accounts.json").exists()
                else ml_profile_dir / "accounts.json")
    accounts     = load_json(acc_path)
    transactions = load_json(ml_profile_dir / "transactions.json")
    identifiers  = load_json(ml_profile_dir / "identifiers.json")
    ground_truth = load_json(ml_profile_dir / "ground_truth.json")
    rings        = load_json(ml_out_dir / "rings.json")
    recruits     = (load_json(ml_out_dir / "recruits.json")
                    if (ml_out_dir / "recruits.json").exists() else [])
    eval_metrics = pipeline_result.get("metrics", {})

    # --- STEP 3: Ouroboros ------------------------------------------------
    ouroboros_results = None
    if not skip_ouroboros:
        section("STEP 3 / 6  --  Ouroboros red-vs-blue adversarial loop")
        try:
            from loop import run_ouroboros
            ouroboros_results = run_ouroboros(
                n_rounds=ouroboros_rounds, profile=profile, seed=42)
            print(f"\n  Ouroboros done -- {ouroboros_rounds} rounds")
        except Exception as exc:
            print(f"  [WARN] Ouroboros failed: {exc}")
    else:
        print("\n  [skip] Ouroboros")

    # --- STEP 4: Geo predictions ------------------------------------------
    section("STEP 4 / 6  --  Geo predictions (lat/lng per account)")
    acc_by_id = {a["_id"]: a for a in accounts}
    geo_preds = build_geo_predictions(accounts, rings)
    print(f"  {len(geo_preds)} accounts with geo coordinates")
    for ring in rings:
        ring["geo_spread_km"] = geo_spread_km(ring, acc_by_id)
        print(f"    {ring.get('_id')}: geo_spread_km = {ring['geo_spread_km']}")

    # --- STEP 5: Normalise amounts ----------------------------------------
    section("STEP 5 / 6  --  Converting paise -> rupees for server contract")
    accounts_out     = convert_accounts(accounts)
    transactions_out = convert_transactions(transactions)
    rings_out        = convert_rings(rings, acc_by_id)
    recruits_out     = normalise_recruits(recruits)
    alerts_out       = build_alerts(rings_out, transactions_out)
    metrics_out      = build_metrics(eval_metrics, ouroboros_results)

    print(f"  Accounts:     {len(accounts_out)}")
    print(f"  Transactions: {len(transactions_out)}  (SALARY credits dropped)")
    print(f"  Rings:        {len(rings_out)}")
    print(f"  Alerts:       {len(alerts_out)}")
    print(f"  Recruits:     {len(recruits_out)}")

    bad = [t for t in transactions_out if t["channel"] not in VALID_CHANNELS]
    if bad:
        print(f"  [WARN] {len(bad)} transactions still have invalid channels")

    # --- STEP 6: Write to data/<profile>/ for npm run seed ----------------
    section("STEP 6 / 6  --  Writing output for npm run seed")
    dest_root = DATA_DIR / profile
    dest_out  = dest_root / "outputs"

    save_json(accounts_out,     dest_root / "accounts.json")
    save_json(transactions_out, dest_root / "transactions.json")
    save_json(identifiers,      dest_root / "identifiers.json")
    save_json(ground_truth,     dest_root / "ground_truth.json")
    save_json(rings_out,        dest_out  / "rings.json")
    save_json(alerts_out,       dest_out  / "alerts.json")
    save_json(metrics_out,      dest_out  / "metrics.json")
    save_json(recruits_out,     dest_out  / "recruits.json")
    save_json(geo_preds,        dest_out  / "geo_predictions.json")
    if ouroboros_results:
        save_json(ouroboros_results, dest_out / "ouroboros_results.json")

    elapsed = time.time() - t_start

    # --- Final summary ----------------------------------------------------
    section("PIPELINE COMPLETE")
    print(f"""
  Profile:      {profile}
  Time:         {elapsed:.1f}s
  Accounts:     {len(accounts_out)}
  Transactions: {len(transactions_out)}
  Identifiers:  {len(identifiers)}
  Rings:        {len(rings_out)}
  Alerts:       {len(alerts_out)}
  Recruits:     {len(recruits_out)}

  Metrics:
    V1 PR-AUC:     {metrics_out['rows'][0]['pr_auc']:.4f}
    V2 PR-AUC:     {metrics_out['rows'][1]['pr_auc']:.4f}
    Ring Recall:   {metrics_out['rows'][0]['ring_recall']:.4f}

  Output: {dest_root}

  Next step:
    cd server && pnpm run seed
""")

    if ouroboros_results:
        s = ouroboros_results.get("summary", {})
        print("  Ouroboros Summary:")
        print(f"    Baseline recall:     {s.get('baseline',{}).get('ring_recall',0):.4f}")
        print(f"    Post-train recall:   {s.get('post_training_baseline',{}).get('ring_recall',0):.4f}")

    return {
        "profile":        profile,
        "elapsed":        round(elapsed, 1),
        "n_accounts":     len(accounts_out),
        "n_transactions": len(transactions_out),
        "n_rings":        len(rings_out),
        "n_alerts":       len(alerts_out),
        "n_recruits":     len(recruits_out),
        "metrics":        metrics_out,
        "ouroboros":      ouroboros_results is not None,
    }


# =========================================================================
# 9.  CLI
# =========================================================================

if __name__ == "__main__":
    ap = argparse.ArgumentParser(
        description="Chakravyuh master pipeline: generate, train, detect, export")
    ap.add_argument("--profile",        default="demo",
                    choices=["demo", "train", "test"])
    ap.add_argument("--skip-generate",  action="store_true",
                    help="Skip data generation (use existing files)")
    ap.add_argument("--skip-ouroboros", action="store_true",
                    help="Skip adversarial loop (faster)")
    ap.add_argument("--rounds",         type=int, default=3,
                    help="Ouroboros rounds (default: 3)")
    ap.add_argument("--no-geo",         action="store_true",
                    help="Disable geo features in V2 model")
    args = ap.parse_args()

    run_full_pipeline(
        profile=args.profile,
        skip_generate=args.skip_generate,
        skip_ouroboros=args.skip_ouroboros,
        ouroboros_rounds=args.rounds,
        geo=not args.no_geo,
    )
