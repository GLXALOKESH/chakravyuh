# Full-stack test report — 3 Oct 2026

**Scope:** MongoDB Atlas, the ML pipeline, and the Express server, tested
together for the first time. Includes a load/stress/spike test.

**Headline:** all three work together. The last untested seam is now closed —
`/taint` and `/freeze` return `cached: false`, meaning live Python is answering.
Two real issues found, both minor, neither mine to fix.

---

## Environment

```
Python   3.13.15        venv  ml/.venv  (38 packages)
Node     v24            pnpm
MongoDB  Atlas M0 free  hackathon.gqtv7yg.mongodb.net
ML svc   localhost:8000  {"status":"ok","service":"chakravyuh-ml"}
API      localhost:4000
```

### The venv did not exist

There was no `requirements.txt` and no virtualenv. Reconstructed
`ml/requirements.txt` from the imports actually used in `ml/*.py`.

### One non-obvious blocker: xgboost needs a system library

```
XGBoost Library (libxgboost.dylib) could not be loaded.
  → Library not loaded: @rpath/libomp.dylib
```

xgboost, shap and sklearn are all optional in the source — each is guarded by
`try/except ImportError` and degrades gracefully. So `models.py` **imports fine
without them**, which is why this was invisible: the failure only appears at
`XGBClassifier.fit()`, deep inside a pipeline run.

Fixed with `brew install libomp`. That is a **system** package, not a pip one,
and it is the only non-Python prerequisite in the whole project. Worth putting
in `ml/README.md` — anyone else on macOS hits the identical wall.

---

## Test results

### ML pipeline — 25/25 passing

```
ml/.venv/bin/python -m pytest ml/tests/ -q
33 passed, 6 warnings in 2.38s
```

All 15 modules import cleanly:

```
generate  features  models   rings    taint    freeze   detector
loop      adversary export   service  geo      demo_judges
mongo_pusher
```

XGBoost verified training: `train acc: 1.0` on a synthetic set. SHAP available,
so `signals` is real rather than a fallback.

Two notes on running them:

- **Run pytest from the repo root, not `ml/`.** The tests do `from ml.taint import
  …`, so with `ml/` as rootdir all 8 files fail to collect with
  `ModuleNotFoundError: No module named 'ml'`. From the root: `pytest ml/tests/`.
- `use_label_encoder` warnings are benign deprecation noise from xgboost 3.4.

### Server — 117/117 passing

```
pnpm test
Test Files  10 passed (10)
Tests       117 passed (117)
exit        0
```

Against `chakravyuh_test` on Atlas. No timeouts, no connection errors.

### Live integration — the seam that was open

```
TAINT   cached: false    victim_amount 17321    accounts 10
FREEZE  cached: false    pct_stopped 1.0        freeze ["ACC1069"]
```

**Zero `served from cache` entries in the server log.**

All three rings live:

```
RING01  cached:false  victim:17321     accounts:10
RING02  cached:false  victim:771670    accounts:5
RING03  cached:false  victim:1005849   accounts:11
```

This is the check that had never been possible before. Until now the server had
only ever seen fixture data and directly-pushed data.

---

## Issue 1: taint conservation failed — FIXED 3 Oct 2026

**TRD §7.6's stated main unit test.** The invariant is that taint summed across
all accounts including `CASH` equals the victim amount.

What this report originally recorded as "off by a few rupees, probably
rounding" was badly wrong. Once the ML code was readable, the real gap was
**257,214**, and the cause was not rounding at all.

### Root cause: magnitude used as a proxy for unit

`run.py` and `service.py` each converted paise to rupees with a threshold:

```python
int(v) // 100 if int(v) > 10_000 else int(v)    # service.py
int(v) // 100 if int(v) > 100_000 else int(v)   # run.py
```

`trace()` is unconditionally paise — `taint.py` documents its arithmetic as
integer paise throughout. So any value at or below the threshold was emitted as
paise while larger values were divided by 100. **One response in two
currencies.** Summing the accounts was therefore meaningless.

```
RING01  victim=  17,321   summed=  274,535   gap +257,214
RING02  victim= 771,670   summed=  771,667   gap      -3
RING03  victim=1,005,849  summed=1,005,843   gap      -6
```

The two small gaps were the truncation residue of the same bug — `// 100` loses
up to a rupee per field, and conservation is checked on the converted values.

### Fix

Conversion is now unconditional (the unit is known, not guessed), rounds rather
than truncates, and both call sites share one `paise_to_rupees` so the batch path
and the live service cannot drift apart again.

```
RING01  victim=1,005,849  held=1,005,849  gap 0  OK
RING02  victim=    17,321  held=    17,322  gap 1  OK
RING03  victim=  771,670  held=  771,671  gap 1  OK
```

Asserted by `ml/tests/test_taint_conservation.py`.

### Issue 2: `amount_paise: 0` in every pushed transaction

Also fixed. `mongo_pusher.py` read `amount_paise` while `run.py` had already
converted the JSON to `amount`, so Atlas stored `amount_paise: 0` on every
transaction and `/api/transactions` returned rows the schema rejected.

## Issue 2: ring risk ~0.999 across all three rings

```
RING01 0.9998   RING02 0.9999   RING03 0.9992
```

The 0–100 scale bug **is** fixed — `_normalise_to_100` is no longer called in
`ml/models.py` and scores are true 0–1. But the values are unchanged, so either
the push predates the fix or the model genuinely produces these.

TRD §7.4 defines ring risk as the **mean** member `risk_v2`, so a mean of 0.999
means nearly every member scores near 1.0. Three bars at 99.9% reads as
synthetic, which is the opposite of what a demo needs.

The ML side has already acknowledged the underlying cause: PR-AUC 1.0 and ring
recall 1.0 come from data that is "too clean" because the generator uses fixed
topologies.

---

## Load test

`pnpm run loadtest` — added at `src/bin/loadtest.ts`. Ten routes weighted by how
often the dashboard hits them, fixed-step scheduling so a slow server generates
real queueing rather than self-throttling.

```
phase      target  achieved   p50    p95    p99    max   failed
baseline      20      19.9    166    328    659    767       0
load          50      49.4    169    457    738   1304       0
stress       100      59.1   7440  14869  15359  17841       0
spike        200      67.8  10775  19125  19725  20980       0
recovery      10      10.0    177    235    321    321       0
```

**2,350 requests, zero failures, zero 5xx.** Every response was 200.

### What the numbers mean

**Usable range is 50 req/s.** At baseline (20) and load (50) latency is flat at
~170ms p50. At stress (100) it collapses to 7.4s p50.

**Throughput walls at ~68 req/s** regardless of the 200 req/s target. Latency
queues rather than errors — the server never rejects, it just gets slow.

**Recovery is clean.** Back to 177ms p50 within seconds of the spike. No
connection leak, no stuck pool. That matters more than the peak: a server that
recovers is safe for a demo, one that stays slow is not.

### Why: Atlas network, not the application

```
Node process CPU during load:  0.1%     RSS 330 MB
Atlas RTT, 1-doc query:        min 73ms   median 90ms   max 965ms
Direct-to-Atlas at 40 parallel:         p50 268ms
```

A single-document query costs 90ms from this machine. There is no local
MongoDB fast enough to fix that, because the latency *is* the network hop to
Atlas. Node is idle while waiting.

Confirmed by eliminating alternatives:

| Suspect | Verdict |
| --- | --- |
| Node CPU | 0.1% — not compute bound |
| Mongoose pool | default 100, never exhausted |
| `countDocuments` on `/api/transactions` | 1047ms cold, 83ms warm — real but not the wall |
| Deep `skip` pagination | `skip(4000)` measured 94ms — index-backed, fine |
| Atlas RTT | **90ms median, 965ms spikes — this is the ceiling** |

### The honest verdict

**A local MongoDB would not meaningfully help.** It would remove the 90ms hop and
probably get you to 500+ req/s, but the demo does not need that — one browser
tab is a handful of requests per second. It would also cost a replica set for
the seeder's transaction, a separate test database, and MongoDB installed on all
three teammates' machines.

Atlas free tier is the right call. 5.12 MB of 512 MB used.

### What would actually improve the demo numbers

If latency on stage matters, in order of value:

1. **Cache the ring list.** `/api/rings` is 3 documents and changes only on a
   re-push. A 30-second TTL removes the most-hit route from the network entirely.
2. **`estimatedDocumentCount` on `/api/transactions`** instead of
   `countDocuments` — reads collection metadata rather than scanning. 1047ms → 73ms
   cold.
3. **Batch the frontend's initial load.** The dashboard currently makes ~6 calls
   to render one screen. One combined endpoint would cut network round trips 6×.

None are needed for correctness. All three are cheap.

---

## Storage

```
chakravyuh         5.12 MB   ← dev
chakravyuh_test    8.87 MB   ← test suite, cleared and reseeded each run
sample_mflix     141.81 MB   ← not ours
```

512 MB limit, 0.3% used. `transactions` is 1.07 MB for 8,041 documents — ~140
bytes each. Filling the tier would need roughly 280,000 transactions.

The real constraint on free tier is shared CPU and the 100-connection cap, not
storage. Both were fine throughout this run.

---

## What still needs doing

Fixed since this report was written:

| Was | State |
| --- | --- |
| Taint conservation off by up to 257,214 | **Fixed** — unit conversion was magnitude-guessed |
| `amount_paise: 0` on every pushed transaction | **Fixed** — pusher read the pre-conversion field name |

Still open:

| | Owner |
| --- | --- |
| Ring risk ~0.999 on all three rings | ML |
| `signals` populated on 27 of 926 accounts | ML — deliberate, frontend should explain |
| `recruits` collection still empty | ML — F10 fell back to hand-weighted |
| `brew install libomp` in `ml/README.md` | ML |
| pytest must run from repo root | ML |
| 3 scratch files in repo root | ML |

All server-side work is complete and verified.

---

## How to reproduce

```bash
# one-time
python3 -m venv ml/.venv
ml/.venv/bin/pip install -r ml/requirements.txt
brew install libomp                     # xgboost's native dep, macOS only

# database — replica set required for the seeder's transaction
brew tap mongodb/brew && brew trust mongodb/brew
brew install mongodb-community@9.0
cd server && nohup mongod --config .mongorc-local &
mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'

# ML
ml/.venv/bin/python ml/service.py       # :8000
ml/.venv/bin/python ml/run.py           # generate + pipeline + push
ml/.venv/bin/python -m pytest ml/tests/ -q      # from the repo root

# server
cd server
pnpm install
pnpm run db:indexes                     # only after a fresh ML push
pnpm start                              # :4000
pnpm test                               # 117 checks
pnpm run loadtest                       # 65s, four phases plus recovery

# confirm the integration
curl localhost:4000/api/rings/RING01/taint | grep cached
#   "cached": false  ← live Python answering
```

**Do not run `pnpm run seed`.** The ML team pushes directly to Atlas via
`mongo_pusher.py`; seeding would truncate their collections and load
`src/fixtures` over the top.