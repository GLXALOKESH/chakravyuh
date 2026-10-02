# ML pipeline: how it works and how it plugs into the server

**For:** Member 3 (ML). Written by Member 1 (server).

This is the ML side end to end: the pipeline order, what each script produces,
how the output reaches the dashboard, and what the server does and does not do
with it.

**Current state: `ml/` is empty. None of this exists yet.** This document is the
specification to build against. It is derived from TRD §7 and from the server
code as it actually is, not from what either of us hopes it will be.

Read alongside:

- `ML_INTEGRATION.md` — exact file formats, byte for byte
- `HOW_DATA_FLOWS.md` — what the server does after you write the files
- `COMMUNICATION.md` §4 — the live endpoints

---

## The shape of the whole thing

```
┌─ OFFLINE, run by you ──────────────────────────────────────┐
│                                                            │
│  generate.py  ─► features.py ─► models.py ─► rings.py      │
│                                        │           │       │
│                                        │      roles│       │
│                                        ▼           ▼       │
│                                  taint.py ─► freeze.py     │
│                                        │           │       │
│                                        └─────┬─────┘       │
│                                              ▼             │
│                                        outputs/*.json      │
└──────────────────────────────────────────┬─────────────────┘
                                           │
                    npm run seed (the only handoff)
                                           │
┌─ ONLINE, run by the server ───────────────▼─────────────────┐
│                                                            │
│  MongoDB ─► REST API ─► dashboard ─► Socket.IO replay      │
│                                                            │
│                     POST /taint ──► your service  (live)    │
│                     POST /mincut ─► your service  (live)    │
└────────────────────────────────────────────────────────────┘
```

**One handoff point.** Your JSON files on disk. There is no streaming, no shared
database, no message queue. You write, the seeder reads, and both sides agree on
a file format. That is deliberate — it is the one thing that cannot break
mid-demo.

---

## 1. Pipeline order

TRD §7.1. Six scripts, run in this order by `pipeline.py`:

```
generate.py   synthetic accounts, identifiers, transactions
     │
     ▼
features.py   per-account feature vectors (§7.2)
     │
     ▼
models.py     V1 (transactions only) and V2 (with identity)
     │        scores every account, emits `signals[]` per account
     │
     ├──────────────┐
     ▼              ▼
rings.py        models.py --recruits
Louvain + roles  (§7.8)
     │
     ├──────────┬──────────┐
     ▼          ▼          ▼
  taint.py   freeze.py   outputs/*.json
  (§7.6)      (§7.7)
```

```bash
python ml/pipeline.py --profile demo
```

TRD §7.1: **must finish in under 60 seconds** on the demo profile. That budget
is what makes it demoable — it can be run live on stage.

`generate.py` is separate and runs first:

```bash
python ml/generate.py --profile demo     # writes data/demo/*.json
python ml/pipeline.py --profile demo     # writes data/demo/outputs/*.json
```

Train on the `train` profile, report on `test`, score `demo` (TRD §7.3). The
`demo` profile is what the dashboard shows, so it must be self-consistent — you
cannot score a profile your model never saw the distribution of.

---

## 2. What each script writes

| Script | Writes | To |
| --- | --- | --- |
| `generate.py` | `accounts.json`, `identifiers.json`, `transactions.json`, `ground_truth.json` | `data/<profile>/` |
| `models.py` | scores and signals → merged into `accounts.json` by the seeder | — |
| `rings.py` | `outputs/rings.json`, `outputs/alerts.json` | `data/<profile>/outputs/` |
| `taint.py` | `default_taint` inside each ring | inside `rings.json` |
| `freeze.py` | `default_freeze` inside each ring | inside `rings.json` |
| `models.py --recruits` | `outputs/recruits.json` | `data/<profile>/outputs/` |
| `pipeline.py` (eval) | `outputs/metrics.json` | `data/<profile>/outputs/` |

Note where `default_taint` and `default_freeze` live: **inside each ring
document**, not as separate files. The seeder reads `rings.json` and the
per-ring defaults ride along.

### The 16 features of §7.2

Computed per account from its own transactions. The split matters:

- **V1 and V2** — `amount_in`, `amount_out`, `txn_in`, `txn_out`,
  `pass_through`, `median_hold_min`, `velocity_per_hr`, `burst_10min`,
  `counterparty_diversity`, `in_degree`, `out_degree`, `account_age_days`,
  `atm_share`
- **V2 only** — `shared_device_n`, `shared_phone_n`, `shared_ip_n`,
  `shared_any_new_n`, `neighbour_risk_v1`, `home_cashout_km`,
  `cashout_city_n`

`metrics.json` reports both V1 and V2 precisely so the demo can show that
identity linking is what catches the rings transaction-flow alone misses. If V2
does not beat V1, that is a finding worth reporting, not something to hide.

### Ring discovery, §7.4

1. Accounts with `risk_v2 >= 0.5`, plus everything sharing an identifier or
   transaction with them.
2. Undirected graph. Edge weight = `1.0` per shared identifier, plus
   `amount / median_ring_amount` capped at `3.0`.
3. `nx.community.louvain_communities(G, weight="weight", seed=42)`.
4. Keep communities with ≥3 accounts and mean `risk_v2 >= 0.6`.

`seed=42` is fixed so results are reproducible. Tuning thresholds on `train` and
then leaving them fixed is required — thresholds tuned on `demo` are just
overfitting the demo.

### Roles, §7.5

First match wins, in this order. **Every role carries a `role_reason` sentence** —
the dashboard shows it, and a role with no reason is a role nobody trusts.

| Order | Role | Rule |
| --- | --- | --- |
| 1 | `coordinator` | Shares identifiers with ≥3 members, carries <10% of ring volume |
| 2 | `source` | ≥half its inflow from outside the ring, earliest active member |
| 3 | `cash-out` | ≥half its outflow goes to `CASH` |
| 4 | `mule` | Receives from a source, `pass_through >= 0.8`, `median_hold_min < 30` |
| 5 | `relay` | Senders and receivers are both members |
| 6 | `member` | Anything else |

### Taint, §7.6 — the algorithm is given in the TRD

Proportional: money leaving an account carries the same tainted share as that
account's balance at that moment. The TRD has working Python — use it rather
than reimplementing.

The invariant that matters most:

> **Sum of `taint` across all accounts, including `CASH`, equals the victim
> amount.**

That is the main unit test for the whole feature. `CASH` taint is money already
withdrawn and is displayed as "lost" — it should be non-zero, because laundering
ends somewhere.

Lien per account = `min(taint[a], bal[a])`, rounded to the rupee.

### Freeze, §7.7 — minimum cut

Which `k` accounts, frozen at `as_of`, stop the most tainted money reaching
`CASH`?

Rings are small, so brute force over combinations when ≤15 members, greedy above
that. Brute force is exact and easier to debug than a max-flow formulation, and
TRD §7.7 recommends it for exactly that reason.

### Recruits, §7.8

Candidates are accounts outside the ring sharing an identifier, or within 2 hops.
Training labels come from cutting each ring's history just before its last
members join.

If time runs out, the hand-weighted fallback is sanctioned by the TRD — but then
label it **"risk score", not "probability"**. The distinction matters to whoever
reads the dashboard.

---

## 3. The handoff: `npm run seed`

```bash
cd server && npm run seed
```

This is the only integration point. It:

1. reads all eight files
2. creates indexes
3. **truncates and reloads inside one transaction**
4. records `seed_meta` for freshness

```
seeded demo from data/demo into hackathon.gqtv7yg.mongodb.net/chakravyuh
  accounts      600
  identifiers   35
  transactions  4972
  rings         3
  alerts        3
  ground truth rings: 3, populated: 3
  victim transaction: TXN003975
```

That `from data/demo` line is the one to check. If it says
`from src/fixtures`, your files were not found — check `SEED_PROFILE` and that
`data/<profile>/` exists.

Failures are loud, with the field named. Nothing loads partially.

---

## 4. Live service

Two things run at request time, not at seed time.

```bash
python ml/app.py          # or whatever serves it
# http://localhost:8000
```

TRD §7.10: load `data/<profile>/` into memory at startup so each call is a pure
computation. No per-request disk reads.

| Route | Body | Returns |
| --- | --- | --- |
| `POST /taint` | `{ ring_id, victim_txn_id, as_of }` | §8 taint shape |
| `POST /mincut` | `{ ring_id, victim_txn_id, as_of, k, exclude }` | §8 freeze shape |
| `POST /recruits` | `{ ring_id }` | §8 recruits shape |
| `GET /health` | none | `{ ok: true }` |

### `cached: true` is the thing to watch

On timeout, connection error or non-2xx, the server returns the ring's stored
`default_taint` / `default_freeze` with `"cached": true`. No route fails because
Python is down — that is deliberate, a demo must not die because a process is
slow.

But it fails **quietly**. The server logs one line:

```
GET /rings/RING01/taint served from cache: /taint: fetch failed
```

If every taint and freeze response has `cached: true`, your service is not being
reached and the dashboard is showing numbers I stored, not numbers your model
produced. Check `/health` on 8000 first when something looks stale.

### 3 seconds, and it is not negotiable

TRD §3 fixes `ML_TIMEOUT_MS` at 3000. If `/mincut` takes 4s on a 16-member ring,
brute force over combinations is the likely culprit — it is exponential in `k`.

If you cannot fit the budget, tell me before the demo. The options are precompute,
prune the graph, or raise the timeout knowingly. A cache that always fires is
worse than no live path, because nobody notices.

### Two rules the server enforces

- `accounts[].tainted` must sum to `victim_amount`.
- `freeze` must never contain an account from `exclude` (TRD §7.7). The server
  recomputes `pct_stopped` on the cached path so exclusion still visibly lowers
  the percentage — that is what demo step 6 depends on.

---

## 5. Replay

At startup the server loads every transaction in timestamp order. The play
button advances a virtual clock at `REPLAY_DEFAULT_SPEED` (60× real time) and
your transactions are emitted as the clock passes their `ts`. Alerts fire at
their `fired_at`.

**`ts` must be a real ISO 8601 date.** A string or an epoch integer sorts
wrong, transactions emit out of order, and nothing errors — the demo just looks
broken.

Full fixture run: 4,972 `txn`, 3 `alert`, ~25 clock ticks, `replay:end` once.

---

## 6. What the server does NOT do

Stated explicitly so there are no assumptions:

- **It computes nothing.** No risk scores, no ring detection, no clustering, no
  features. Every number on the dashboard came out of your JSON files.
- **It does not call you except for taint and freeze.** `GET
  /api/rings/:id/recruits` is served from `recruits.json`. TRD §3 permits only
  those two live calls.
- **It does not write to `data/`.** Read-only, aside from nothing.
- **It does not run your pipeline.** See §7.
- **It never sends `is_fraud` anywhere.** Stored, never serialised.

---

## 7. The pipeline trigger: not built

TRD §7.10 specifies `POST /pipeline/run`. On the server side:

- `runPipeline()` exists in `src/services/ml.service.ts`
- `PipelineRunBodyDto` is defined
- **there is no controller and no route registered**

So the reverse direction — server asks Python to regenerate — is not wired. And
a gap behind it: nothing re-seeds after a run, so even with the route present the
server would keep serving stale data.

**For now, the loop is manual and that is fine:**

```bash
python ml/pipeline.py --profile demo
cd server && npm run seed
```

One extra command in a rehearsed demo step is not a risk. An auto-reseed is a
moving part that can fail on stage in a way a manual command never will. If you
want it built for development, say so — it is roughly 30 lines.

---

## 8. Build order

If you are picking this up from scratch, this order gets a visible result fastest
and validates the handoff early rather than at the end.

**Step 1 — generator + fixtures (do this first).** Nothing downstream can be
tested without data. Output must satisfy the §5 invariants: every account has
`home`, every ATM txn has `location`, cash-out is `to: "CASH"`, account E shares
a device with a ring member and has no ring transactions.

**Step 2 — wire the handoff and verify.** Run `npm run seed` and confirm the
counts print and `from data/demo` appears. Do this before writing any model, so
you know the plumbing works before there is anything to plumb.

**Step 3 — features + models (F2, F3).** Train on `train`, report on `test`,
score `demo`. Emit `risk_v1`, `risk_v2`, `signals[]` into `accounts.json`. Get
`metrics.json` written with real numbers.

**Step 4 — rings + roles (F4, F5).** Louvain, thresholds tuned on `train` and
then frozen. Roles with reasons.

**Step 5 — taint + freeze defaults (F8, F9).** Put real values in
`default_taint` and `default_freeze`. This is what makes the dashboard work when
Python is down, and it is the step most likely to be left as `{}`.

**Step 6 — recruits (F10).** Optional. The endpoint reads a collection nothing
writes yet.

**Step 7 — the live service.** `app.py` on 8000 with `/health`, `/taint`,
`/mincut`. Start here and you can test against the running server immediately.

---

## 9. Reference numbers

From the built-in fixture generator, so you can tell whether you are looking at
the fallback or at real output:

| | |
| --- | --- |
| accounts | 600 |
| identifiers | 35 |
| transactions | 4,972 |
| rings | 3 (`RING01`, `RING02`, `RING03`) |
| alerts | 3 |
| victim transaction | `TXN003975` |
| account E | `ACC0311` (shares `DEV017`, no ring transactions) |

Freeze behaviour on `RING01`, which should hold for your data too:

```
k:3                              pct_stopped 0.643
k:3, exclude:["ACC0040"]         pct_stopped 0.302
k:10, exclude:[two accounts]     pct_stopped 0.129
```

`CASH` is a sentinel, never an account document. Account E is deliberately
unlabelled — it is the negative case the recruitment predictor is scored against.

---

## 10. Open questions

1. **`default_taint` structure.** TRD §6 shows `{}`. The cached freeze path
   recomputes `secured` and `pct_stopped` from per-account taint, so this needs
   `{ account_id: taint }` or similar. What shape are you producing?
2. **The 3 second budget.** Brute force over combinations is exponential in `k`.
   Can it hold, or do you want the timeout raised knowingly?
3. **Pattern D recall.** Both fixture metric rows are `null`. Is a pattern-D
   detector coming?
4. **`geo_spread_km`.** Map is P2 per TRD §11. Populate now or leave null?
5. **V2 versus V1.** The demo narrative is that identity linking catches what
   transaction flow misses. If your numbers do not show that, better to know now.

Anything in here you disagree with, say so and I will change the server. Cheaper
to argue now than to debug during the demo.
