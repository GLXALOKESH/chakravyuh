"""
online.py  —  Chakravyuh live (streaming) predictor
=====================================================
The stateful scorer behind POST /predict. Transactions arrive in time order,
a batch at a time; each batch updates per-account feature state, rescores
only the accounts it touched, and from time to time looks for rings among
the high-risk ones.

Same models and the same feature definitions as the batch pipeline:

  * AccountState reproduces the inline feature code in
    features.compute_features (not the unused _compute_core), one
    transaction at a time. tests/test_online_parity.py checks the two agree.
  * neighbour_risk_v1 is fed as 0.0. The batch pipeline trains on features
    computed without a V1 risk map, so the model only ever saw 0.0 there.
  * Ring discovery and roles reuse rings.discover_rings and
    rings.classify_roles on the high-risk neighbourhood only, so Louvain runs
    on a few hundred accounts rather than the whole ledger.

What the predictor never receives: is_fraud, ring labels or roles. The
generator keeps those apart and the server does not forward them. Victim
deposits are found the way a bank would see them: money arriving from an
external VICTIM_* account.

Models are trained on the `train` profile the first time the service starts
(about 3 seconds) and saved under saved_models/online/ in XGBoost's own JSON
format, which survives library upgrades better than a pickle.
"""

from __future__ import annotations

import contextlib
import io
import json
import pickle
import statistics
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

try:
    from ml.features import V1_FEATURES, explain_signals, v2_features
    from ml.rings import classify_roles, discover_rings
except ImportError:
    from features import V1_FEATURES, explain_signals, v2_features
    from rings import classify_roles, discover_rings

ML_DIR = Path(__file__).resolve().parent
MODEL_DIR = ML_DIR / "saved_models" / "online"

CASH = "CASH"
SALARY = "SALARY"
NEW_ACCOUNT_DAYS = 14          # features._compute_identity start_cutoff_days
RING_THRESHOLD = 0.5           # prob_v2 an account needs to seed ring discovery
DISCOVER_EVERY_S = 300         # simulated seconds between discovery runs
SCORE_CHANGE = 0.02            # smallest change in risk worth sending again
SIGNALS_PER_BATCH = 50
#: Days into the training window at which accounts are snapshotted for training (see train_online_models).
SNAPSHOT_DAYS = (2, 3, 5, 8, 12, 18, 30)
BANDS = ((0.80, "CRITICAL"), (0.60, "HIGH"), (0.35, "MEDIUM"), (0.0, "LOW"))


def parse_ts(ts: str) -> datetime:
    return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def is_pseudo(account_id: str) -> bool:
    """Accounts that are not customers: cash, salary, and the victims' external accounts."""
    return account_id in (SALARY, CASH) or account_id.startswith("VICTIM")


def band(risk: float) -> str:
    return next(name for floor, name in BANDS if risk >= floor)


# ─────────────────────────────────────────────────────────────────
# 1.  MODELS
# ─────────────────────────────────────────────────────────────────

def _load_json(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def training_fingerprint() -> str:
    """Size and modification time of the training data: new data means new models."""
    f = ML_DIR / "data" / "train" / "transactions.json"
    try:
        st = f.stat()
        return f"{st.st_size}:{int(st.st_mtime)}"
    except OSError:
        return "missing"


def train_online_models(model_dir: Path = MODEL_DIR):
    """Train V1, V2 and the isolation forest on the `train` profile and save them."""
    import xgboost as xgb

    try:
        from ml.features import compute_features
        from ml.models import train_models
    except ImportError:
        from features import compute_features
        from models import train_models

    train_dir = ML_DIR / "data" / "train"
    if not (train_dir / "transactions.json").exists():
        try:
            from ml.generate import generate_profile
        except ImportError:
            from generate import generate_profile
        generate_profile("train")

    accounts = _load_json(train_dir / "accounts.json")
    txns = _load_json(train_dir / "transactions.json")
    identifiers = _load_json(train_dir / "identifiers.json")
    truth = _load_json(train_dir / "ground_truth.json")

    # Snapshots, not just the finished month. Live, an account is scored on
    # the history it has so far: a few days of it, often with its ring's
    # cascade only part played. A model that has only seen complete 30-day
    # histories misreads those. So the training set holds every account as it
    # stood after each cutoff below. A ring member counts as fraud only once
    # its ring has started; before that it is left out, being so far
    # indistinguishable from anyone else.
    fraud = {m for ring in truth for m in ring["member_ids"]}
    txns = sorted(txns, key=lambda t: t["ts"])
    start = parse_ts(txns[0]["ts"])
    first_fraud: dict[str, str] = {}
    for t in txns:
        if t.get("is_fraud"):
            for side in (t["from"], t["to"]):
                if side in fraud:
                    first_fraud.setdefault(side, t["ts"])
    frames, labels = [], {}
    with contextlib.redirect_stdout(io.StringIO()):
        for days in SNAPSHOT_DAYS:
            cutoff = (start + timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
            seen = [t for t in txns if t["ts"] <= cutoff]
            df = compute_features(accounts, seen, identifiers)
            active = {a for t in seen for a in (t["from"], t["to"])}
            keep = [a for a in df.index if a in active and (a not in fraud or first_fraud.get(a, "~") <= cutoff)]
            df = df.loc[keep]
            df.index = [f"{a}@{days}" for a in df.index]
            frames.append(df)
            labels.update({f"{a}@{days}": a in fraud for a in keep})
        df = pd.concat(frames)
        labels = pd.Series(labels)
        v1, v2, iso, _scaler = train_models(df, labels)

    raw = iso.decision_function(df[V1_FEATURES].fillna(0))
    meta = {
        "v1_cols": list(V1_FEATURES),
        "v2_cols": list(v2_features(False)),
        "iso_min": float(raw.min()),
        "iso_max": float(raw.max()),
        "xgboost": xgb.__version__,
        "trained_on": "train",
        "snapshot_days": list(SNAPSHOT_DAYS),
        "train_data": training_fingerprint(),
        "trained_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "accounts": int(len(df)),
        "fraud_accounts": int(labels.sum()),
    }
    model_dir.mkdir(parents=True, exist_ok=True)
    v1.save_model(model_dir / "v1.json")
    v2.save_model(model_dir / "v2.json")
    with open(model_dir / "iso.pkl", "wb") as f:
        pickle.dump(iso, f)
    with open(model_dir / "meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    return v1, v2, iso, meta


def load_or_train(model_dir: Path = MODEL_DIR):
    """Saved online models if they load, otherwise a fresh training run. Returns (v1, v2, iso, meta, source)."""
    import xgboost as xgb

    try:
        meta = _load_json(model_dir / "meta.json")
        if meta.get("xgboost") != xgb.__version__:
            raise ValueError("models were saved by a different XGBoost")
        if meta.get("snapshot_days") != list(SNAPSHOT_DAYS):
            raise ValueError("these models were trained a different way")
        if meta.get("train_data") != training_fingerprint():
            raise ValueError("the training data has changed since these models were trained")
        v1 = xgb.XGBClassifier()
        v1.load_model(model_dir / "v1.json")
        v2 = xgb.XGBClassifier()
        v2.load_model(model_dir / "v2.json")
        with open(model_dir / "iso.pkl", "rb") as f:
            iso = pickle.load(f)
        return v1, v2, iso, meta, "saved"
    except Exception:
        v1, v2, iso, meta = train_online_models(model_dir)
        return v1, v2, iso, meta, "trained"


# ─────────────────────────────────────────────────────────────────
# 2.  PER-ACCOUNT FEATURE STATE
# ─────────────────────────────────────────────────────────────────

class AccountState:
    """Running totals for one account, mirroring features.compute_features."""

    __slots__ = (
        "opened", "amount_in", "amount_out", "txn_in", "txn_out", "atm_amount",
        "senders", "receivers", "unpaired", "holds", "first", "last", "n_ts", "window", "burst",
    )

    def __init__(self, opened: datetime | None):
        self.opened = opened
        self.amount_in = self.amount_out = self.txn_in = self.txn_out = self.atm_amount = 0
        self.senders: set[str] = set()
        self.receivers: set[str] = set()
        # Credits not yet matched to a later debit, oldest first, for the hold time.
        self.unpaired: deque[float] = deque()
        self.holds: list[float] = []
        self.first: float | None = None
        self.last: float | None = None
        self.n_ts = 0
        self.window: deque[float] = deque()
        self.burst = 0

    def _seen(self, ts: float):
        self.n_ts += 1
        if self.first is None:
            self.first = ts
        self.last = ts
        # Most transactions in any 10-minute window: with times arriving in
        # order, the window ending at each one covers every window there is.
        self.window.append(ts)
        while self.window[0] < ts - 600:
            self.window.popleft()
        self.burst = max(self.burst, len(self.window))

    def credit(self, sender: str, ts: float, amount: int):
        self.amount_in += amount
        self.txn_in += 1
        self.senders.add(sender)
        self.unpaired.append(ts)
        self._seen(ts)

    def debit(self, receiver: str, ts: float, amount: int, atm: bool):
        self.amount_out += amount
        self.txn_out += 1
        self.receivers.add(receiver)
        if atm:
            self.atm_amount += amount
        # The batch pairs each debit with the earliest unpaired credit at or
        # before it, skipping debits that have none; in time order that is this.
        if self.unpaired:
            self.holds.append((ts - self.unpaired.popleft()) / 60)
        self._seen(ts)

    def core(self) -> dict:
        count = self.txn_in + self.txn_out
        if self.n_ts >= 2:
            span_hr = max((self.last - self.first) / 3600, 0.0167)
            velocity = self.n_ts / span_hr
        else:
            velocity = 0.0
        age = max((self.first - self.opened.timestamp()) / 86400, 0.0) if self.first is not None and self.opened else 0.0
        return {
            "amount_in": self.amount_in,
            "amount_out": self.amount_out,
            "txn_in": self.txn_in,
            "txn_out": self.txn_out,
            "pass_through": round(min(self.amount_out, self.amount_in) / max(self.amount_in, 1), 6),
            "median_hold_min": round(float(statistics.median(self.holds)) if self.holds else 9999.0, 2),
            "velocity_per_hr": round(velocity, 4),
            "burst_10min": self.burst,
            "counterparty_div": round(len(self.senders | self.receivers) / max(count, 1), 6),
            "in_degree": len(self.senders),
            "out_degree": len(self.receivers),
            "account_age_days": round(age, 2),
            "atm_share": round(self.atm_amount / max(self.amount_out, 1), 6),
        }


# ─────────────────────────────────────────────────────────────────
# 3.  RINGS
# ─────────────────────────────────────────────────────────────────

class RingRegistry:
    """Gives a ring the same id from one discovery run to the next."""

    def __init__(self):
        self.rings: dict[str, dict] = {}
        self.count = 0

    def match(self, members: set[str]) -> str | None:
        best, best_overlap = None, 0.0
        for rid, ring in self.rings.items():
            known = ring["members"]
            overlap = len(members & known) / max(1, min(len(members), len(known)))
            if overlap >= 0.5 and overlap > best_overlap:
                best, best_overlap = rid, overlap
        return best

    def claim(self, members: set[str], clock: str) -> tuple[str, bool]:
        """The id for this community, and whether it is a new ring. Members are only ever added."""
        rid = self.match(members)
        if rid:
            self.rings[rid]["members"] |= members
            return rid, False
        self.count += 1
        rid = f"LIVE-R{self.count:02d}"
        self.rings[rid] = {"members": set(members), "first_seen": clock, "version": 0, "payload": None, "alerted": False}
        return rid, True


# ─────────────────────────────────────────────────────────────────
# 4.  THE SCORER
# ─────────────────────────────────────────────────────────────────

class RunMismatch(Exception):
    """The request belongs to a run this predictor is not on, or skips a batch."""

    def __init__(self, detail: dict):
        super().__init__(json.dumps(detail))
        self.detail = detail


class OnlineScorer:
    def __init__(self, model_dir: Path = MODEL_DIR):
        self.lock = threading.Lock()
        self.model_dir = model_dir
        self.ready = False
        self.model_source = None
        self.meta: dict = {}
        self.v1 = self.v2 = self.iso = None
        self.explainer = None
        self._clear(None, None)

    # ---- lifecycle --------------------------------------------------

    def warm(self):
        """Loads or trains the models. Called once at service start, off the request path."""
        v1, v2, iso, meta, source = load_or_train(self.model_dir)
        explainer = None
        try:
            import shap

            explainer = shap.TreeExplainer(v2)
        except Exception:
            explainer = None
        with self.lock:
            self.v1, self.v2, self.iso, self.meta, self.model_source = v1, v2, iso, meta, source
            self.explainer = explainer
            self.ready = True

    def _clear(self, run_id, sim_start):
        self.run_id = run_id
        self.sim_start = sim_start
        self.seq = 0
        self.last_response: dict | None = None
        self.accounts: dict[str, dict] = {}
        self.opened: dict[str, datetime | None] = {}
        self.state: dict[str, AccountState] = {}
        self.id_type: dict[str, str] = {}
        self.id_members: dict[str, set[str]] = defaultdict(set)
        self.ids_of: dict[str, set[str]] = defaultdict(set)
        self.txns: list[dict] = []
        self.txns_of: dict[str, list[dict]] = defaultdict(list)
        self.scores: dict[str, dict] = {}
        self.sent: dict[str, tuple[float, str]] = {}
        self.signals: dict[str, list] = {}
        self.registry = RingRegistry()
        self.last_discovery: float | None = None
        self.crossed = False
        self.clock: str | None = None
        self.stats = {"discovery_ms": 0.0, "discoveries": 0}

    def reset(self, run_id: str, sim_start: str | None) -> dict:
        with self.lock:
            self._clear(run_id, sim_start)
            return {"ok": True, "run_id": run_id, "model": self.model_info()}

    def model_info(self) -> dict:
        return {
            "ready": self.ready,
            "source": self.model_source,
            "trained_on": self.meta.get("trained_on"),
            "trained_at": self.meta.get("trained_at"),
        }

    def health(self) -> dict:
        return {"ready": self.ready, "run_id": self.run_id, "seq": self.seq, "accounts": len(self.state), "txns": len(self.txns), "rings": len(self.registry.rings)}

    # ---- applying a batch ---------------------------------------------

    def _add_account(self, a: dict):
        aid = a["id"]
        self.accounts[aid] = {
            "_id": aid,
            "holder": a.get("holder"),
            "bank": a.get("bank"),
            "home": a.get("home"),
            "opened_at": a.get("opened_at"),
            "opening_balance": int(a.get("opening_balance_paise", 0)),
        }
        try:
            self.opened[aid] = parse_ts(a["opened_at"])
        except Exception:
            self.opened[aid] = None

    def _apply(self, accounts, identifiers, txns) -> set[str]:
        dirty: set[str] = set()
        for a in accounts:
            self._add_account(a)
        for rec in identifiers:
            iid, aid = rec["id"], rec["account_id"]
            self.id_type[iid] = rec["kind"]
            if aid in self.id_members[iid]:
                continue
            # Everyone already on this identifier now shares it with one more account.
            dirty |= self.id_members[iid]
            self.id_members[iid].add(aid)
            self.ids_of[aid].add(iid)
            dirty.add(aid)
        for t in txns:
            txn = {
                "_id": t["id"],
                "from": t["from"],
                "to": t["to"],
                "amount_paise": int(t["amount_paise"]),
                "ts": t["ts"],
                "channel": t["channel"],
                "location": t.get("location"),
            }
            self.txns.append(txn)
            ts = parse_ts(txn["ts"]).timestamp()
            frm, to, amount = txn["from"], txn["to"], txn["amount_paise"]
            if not is_pseudo(frm):
                self._state(frm).debit(to, ts, amount, txn["channel"] == "ATM")
                self.txns_of[frm].append(txn)
                dirty.add(frm)
            if not is_pseudo(to):
                self._state(to).credit(frm, ts, amount)
                self.txns_of[to].append(txn)
                dirty.add(to)
            if is_pseudo(frm) and frm.startswith("VICTIM"):
                self.txns_of[frm].append(txn)
        return dirty

    def _state(self, aid: str) -> AccountState:
        s = self.state.get(aid)
        if s is None:
            s = self.state[aid] = AccountState(self.opened.get(aid))
        return s

    # ---- features and scores -------------------------------------------

    def _identity(self, aid: str) -> dict:
        sharing = defaultdict(set)
        for iid in self.ids_of.get(aid, ()):
            sharing[self.id_type[iid]] |= self.id_members[iid] - {aid}
        everyone = sharing["device"] | sharing["phone"] | sharing["ip"]
        mine = self.opened.get(aid)
        new = 0
        if mine:
            for other in everyone:
                theirs = self.opened.get(other)
                if theirs and abs((mine - theirs).total_seconds()) / 86400 <= NEW_ACCOUNT_DAYS:
                    new += 1
        return {
            "shared_device_n": len(sharing["device"]),
            "shared_phone_n": len(sharing["phone"]),
            "shared_ip_n": len(sharing["ip"]),
            "shared_any_new_n": new,
            "neighbour_risk_v1": 0.0,
        }

    def features_for(self, ids) -> pd.DataFrame:
        rows = [{"account_id": aid, **self.state[aid].core(), **self._identity(aid)} for aid in ids if aid in self.state]
        if not rows:
            return pd.DataFrame(columns=["account_id", *v2_features(False)]).set_index("account_id")
        return pd.DataFrame(rows).set_index("account_id")

    def _score(self, ids) -> pd.DataFrame:
        df = self.features_for(ids)
        if df.empty:
            return df
        x1 = df[self.meta["v1_cols"]].fillna(0)
        x2 = df[self.meta["v2_cols"]].fillna(0)
        p1 = self.v1.predict_proba(x1)[:, 1]
        p2 = self.v2.predict_proba(x2)[:, 1]
        raw = self.iso.decision_function(x1)
        lo, hi = self.meta["iso_min"], self.meta["iso_max"]
        # Bounds fixed at training time: a batch-relative min/max means nothing for a handful of rows.
        anomaly = np.clip(1.0 - (raw - lo) / max(hi - lo, 1e-9), 0.0, 1.0)
        df = df.copy()
        df["prob_v1"] = p1
        df["prob_v2"] = p2
        df["risk_v2"] = p2
        df["anomaly"] = anomaly
        df["risk"] = np.clip(0.6 * p2 + 0.3 * p1 + 0.1 * anomaly, 0.0, 1.0)
        for aid, row in df.iterrows():
            before = self.scores.get(aid, {}).get("risk_v2", 0.0)
            if before < RING_THRESHOLD <= row["prob_v2"]:
                self.crossed = True
            self.scores[aid] = {
                "risk_v1": float(row["prob_v1"]),
                "risk_v2": float(row["prob_v2"]),
                "anomaly": float(row["anomaly"]),
                "risk": float(row["risk"]),
                "txns": int(row["txn_in"] + row["txn_out"]),
            }
        return df

    def _signals(self, df: pd.DataFrame, ids: list[str]) -> dict[str, list]:
        if not ids:
            return {}
        cols = self.meta["v2_cols"]
        rows = df.loc[ids, cols].fillna(0)
        out: dict[str, list] = {}
        if self.explainer is not None:
            try:
                values = self.explainer.shap_values(rows)
                values = values[1] if isinstance(values, list) else values
                for i, aid in enumerate(ids):
                    out[aid] = explain_signals([(c, float(values[i][j]), float(rows.iloc[i][c])) for j, c in enumerate(cols)])
                return out
            except Exception:
                self.explainer = None
        # Without SHAP: the model's own feature gain, weighted by the account's value.
        gain = self.v2.get_booster().get_score(importance_type="gain")
        total = max(sum(gain.values()), 1e-9)
        for aid in ids:
            out[aid] = explain_signals([(c, gain.get(c, 0.0) / total, float(rows.loc[aid, c])) for c in cols])
        return out

    # ---- rings ---------------------------------------------------------

    def _neighbourhood(self, seeds: set[str]) -> set[str]:
        around = set(seeds)
        for aid in seeds:
            s = self.state.get(aid)
            if s:
                around |= {x for x in (s.senders | s.receivers) if not is_pseudo(x)}
            for iid in self.ids_of.get(aid, ()):
                around |= self.id_members[iid]
        return around

    def _ring_payload(self, rid: str, members: set[str], roles: dict) -> dict:
        edges: dict[tuple, dict] = {}
        volume = 0
        first_ts = last_ts = None
        seen: set[str] = set()
        victim_ids = []
        for aid in members:
            for t in self.txns_of.get(aid, ()):
                if t["_id"] in seen:
                    continue
                seen.add(t["_id"])
                frm, to = t["from"], t["to"]
                if frm in members and to in members:
                    e = edges.setdefault((frm, to), {"from": frm, "to": to, "amount": 0, "count": 0})
                    e["amount"] += t["amount_paise"]
                    e["count"] += 1
                    volume += t["amount_paise"]
                    first_ts = t["ts"] if first_ts is None or t["ts"] < first_ts else first_ts
                    last_ts = t["ts"] if last_ts is None or t["ts"] > last_ts else last_ts
                elif frm.startswith("VICTIM") and to in members:
                    victim_ids.append(t["_id"])
        links = []
        for iid, accts in self.id_members.items():
            inside = sorted(accts & members)
            if len(inside) >= 2:
                links.append({"identifier": iid, "type": self.id_type[iid], "account_ids": inside})
        risks = [self.scores.get(a, {}).get("risk_v2", 0.0) for a in members]
        return {
            "id": rid,
            "member_ids": sorted(members),
            "roles": {a: roles.get(a, {"role": "member", "role_reason": "Joined the ring after its roles were assigned"}) for a in members},
            "edges": list(edges.values()),
            "identity_links": links,
            "volume_paise": volume,
            "risk": round(float(np.mean(risks)) if risks else 0.0, 4),
            "victim_txn_ids": sorted(victim_ids),
            "first_txn": first_ts,
            "last_txn": last_ts,
        }

    def _reason(self, ring: dict) -> str:
        n = len(ring["member_ids"])
        rupees = ring["volume_paise"] // 100
        amount = f"₹{rupees / 100000:.1f} lakh" if rupees >= 100000 else f"₹{rupees:,}"
        parts = [f"{n} linked accounts moved {amount}"]
        if ring["first_txn"] and ring["last_txn"] and sum(e["count"] for e in ring["edges"]) >= 2:
            minutes = (parse_ts(ring["last_txn"]) - parse_ts(ring["first_txn"])).total_seconds() / 60
            parts[0] += f" within {max(1, round(minutes))} min" if minutes < 120 else f" within {minutes / 60:.0f} h"
        if ring["identity_links"]:
            widest = max(ring["identity_links"], key=lambda link: len(link["account_ids"]))
            parts.append(f"{len(widest['account_ids'])} share one {widest['type']}")
        return "; ".join(parts)

    def _discover(self, clock: str) -> tuple[list[dict], list[dict]]:
        began = time.perf_counter()
        seeds = {a for a, s in self.scores.items() if s["risk_v2"] >= RING_THRESHOLD and s["txns"] >= 2}
        changed_rings: list[dict] = []
        alerts: list[dict] = []
        found: list[tuple[set[str], dict]] = []
        if len(seeds) >= 1:
            around = self._neighbourhood(seeds)
            scored = self._score(around)
            txns, ids = [], []
            seen: set[str] = set()
            for aid in around:
                for t in self.txns_of.get(aid, ()):
                    if t["_id"] not in seen:
                        seen.add(t["_id"])
                        txns.append(t)
            for iid, accts in self.id_members.items():
                if accts & around:
                    ids.append({"_id": iid, "type": self.id_type[iid], "account_ids": sorted(accts)})
            # discover_rings prints progress; the service's output is not the place for it.
            with contextlib.redirect_stdout(io.StringIO()):
                communities = discover_rings([{"_id": a} for a in around], txns, ids, scored, risk_threshold=RING_THRESHOLD, seed=42)
                for ring in communities:
                    found.append((set(ring["member_ids"]), classify_roles(ring, txns, ids, scored)))

        claimed: set[str] = set()
        roles_for: dict[str, dict] = {}
        for members, roles in found:
            rid, _new = self.registry.claim(members, clock)
            claimed.add(rid)
            roles_for[rid] = roles

        # Every known ring is refreshed: money keeps moving after it is found.
        for rid, entry in self.registry.rings.items():
            roles = roles_for.get(rid) or (entry["payload"] or {}).get("roles", {})
            payload = self._ring_payload(rid, entry["members"], roles)
            previous = entry["payload"]
            if previous is None or {k: v for k, v in payload.items() if k != "risk"} != {k: v for k, v in previous.items() if k != "risk"}:
                entry["version"] += 1
                entry["payload"] = payload
                changed_rings.append({**payload, "version": entry["version"], "first_seen": entry["first_seen"]})
            if not entry["alerted"]:
                entry["alerted"] = True
                alerts.append({"id": f"LIVE-A{rid[-2:]}", "ring_id": rid, "fired_at": clock, "reason": self._reason(payload)})

        self.stats["discovery_ms"] = round((time.perf_counter() - began) * 1000, 1)
        self.stats["discoveries"] += 1
        return changed_rings, alerts

    # ---- the request -----------------------------------------------------

    def predict(self, req: dict) -> dict:
        with self.lock:
            if not self.ready:
                raise RuntimeError("models are still loading")
            run_id, seq = req.get("run_id"), int(req.get("seq", 0))
            if run_id != self.run_id:
                raise RunMismatch({"error": "run_mismatch", "run_id": self.run_id})
            if seq <= self.seq and self.last_response is not None and seq == self.last_response["seq"]:
                return {**self.last_response, "applied": False}
            if seq != self.seq + 1:
                raise RunMismatch({"error": "expected_seq", "expected_seq": self.seq + 1})

            began = time.perf_counter()
            dirty = self._apply(req.get("accounts", []), req.get("identifiers", []), req.get("txns", []))
            clock = req.get("clock") or (req["txns"][-1]["ts"] if req.get("txns") else self.clock)
            self.clock = clock or self.clock
            scored_ids = [a for a in dirty if a in self.state]
            df = self._score(scored_ids)

            updates = []
            for aid in scored_ids:
                s = self.scores[aid]
                b = band(s["risk_v2"])
                was = self.sent.get(aid)
                if was is None or abs(was[0] - s["risk_v2"]) >= SCORE_CHANGE or was[1] != b:
                    self.sent[aid] = (s["risk_v2"], b)
                    updates.append({"id": aid, "risk_v1": round(s["risk_v1"], 4), "risk_v2": round(s["risk_v2"], 4), "anomaly": round(s["anomaly"], 4), "risk": round(s["risk"], 4), "band": b, "provisional": s["txns"] < 3})

            # Reasons for the accounts worth explaining, a few per batch.
            flagged = [u["id"] for u in updates if u["risk_v2"] >= 0.5][:SIGNALS_PER_BATCH]
            if flagged and not df.empty:
                for aid, sig in self._signals(df, flagged).items():
                    self.signals[aid] = sig
                for u in updates:
                    if u["id"] in self.signals:
                        u["signals"] = self.signals[u["id"]]

            rings: list[dict] = []
            alerts: list[dict] = []
            now = parse_ts(self.clock).timestamp() if self.clock else 0.0
            if self.crossed or (self.last_discovery is not None and now - self.last_discovery >= DISCOVER_EVERY_S and self.registry.rings) or (
                self.last_discovery is None and any(s["risk_v2"] >= RING_THRESHOLD for s in self.scores.values())
            ):
                rings, alerts = self._discover(self.clock)
                self.last_discovery = now
                self.crossed = False

            self.seq = seq
            response = {
                "seq": seq,
                "applied": True,
                "took_ms": round((time.perf_counter() - began) * 1000, 1),
                "scores": updates,
                "rings": rings,
                "alerts": alerts,
                "stats": {"accounts": len(self.state), "txns": len(self.txns), "rings": len(self.registry.rings), **self.stats},
            }
            self.last_response = response
            return response

    # ---- for /taint and /mincut on a live ring ---------------------------------

    def ledger_view(self, ring_id: str):
        """(ring, transactions, accounts) in the batch shapes taint.trace and freeze.recommend_freeze take."""
        with self.lock:
            entry = self.registry.rings.get(ring_id)
            if not entry or not entry["payload"]:
                return None
            payload = entry["payload"]
            ring = {"_id": ring_id, "ring_id": ring_id, "member_ids": payload["member_ids"], "victim_txn_ids": payload["victim_txn_ids"]}
            return ring, list(self.txns), list(self.accounts.values())
