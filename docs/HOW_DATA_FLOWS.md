# How the backend consumes and processes your data

**For:** Member 3 (ML). Companion to `ML_INTEGRATION.md`, which specifies the
file formats. This one explains what happens to your files after you write them.

> **Superseded in part, 3 Oct 2026.** The pipeline now pushes directly to Atlas
> via `mongo_pusher.py`, so the seeding flow below is the fallback path rather
> than the normal one. What still holds and matters: what the server does with
> your numbers, why `cached: true` appears, what silently looks wrong, and the
> replay rules. `PROJECT_STATUS.md` has the current position.

Read this if you want to know why a seed failed, what "cached" means, or what
the server does with your numbers.

---

## The short version

```
you write JSON          pnpm run seed              pnpm start
     │                      │                         │
     ▼                      ▼                         ▼
data/demo/*.json ──► read, validate, ──► MongoDB ──► REST API ──► dashboard
                    one transaction                    │
                                                        └──► replay socket
                                                             replays your
                                                             transactions in
                                                             timestamp order
```

Two things to take from that:

1. **Your JSON files are read once, at seed time.** After that everything is
   served from MongoDB. Changing a file does nothing until you re-seed.
2. **Nothing is computed at request time except taint and freeze.** Every score,
   ring, alert and metric on the dashboard is something you already wrote to
   disk. The server joins and shapes; it does not analyse.

---

## 1. Seeding: `pnpm run seed`

### Order of operations

Indexes are created **before** the write, not after. A fresh database has none,
and a bulk insert into an unindexed collection leaves a window where every query
does a full collection scan.

Then, inside **one transaction**:

```
truncate  →  rings  →  accounts  →  identifiers  →  transactions
          →  alerts  →  recruits  →  metrics
```

Rings go first because `accounts.ring_id`, `alerts.ring_id` and
`recruits.ring_id` all point at them.

MongoDB gives no foreign keys, so nothing would stop you writing them in any
order — this is about making the intent readable, not about a constraint.

Finally `seed_meta` records what was loaded and when, so the dashboard can show
data freshness.

### Why one transaction matters to you

If `transactions.json` has a bad `channel` at line 4,000, the load **rolls back
completely**. The previous dataset is untouched and still serving.

This is the practical reason the server keeps MongoDB rather than reading JSON on
every request. Without a transaction you get a half-seeded database: some rings
referencing accounts that were never inserted, and a demo that fails in ways
nobody can explain.

So **you can re-run the seed as often as you like.** It is not a one-time setup
step.

### What "validated" means

Every document is checked against its Mongoose schema before insert. Two
consequences worth knowing:

- A missing required field (`ts`, `channel`, `_id`) or a bad enum value is
  rejected with the field named. The seed stops and prints the error.
- Checks are explicit rather than relying on `insertMany`. This is not a detail:
  `insertMany` with `ordered: false` **silently drops** documents that fail
  validation instead of raising. An early version of this seeder had that
  behaviour, and the effect was an unknown channel making a transaction vanish
  from the dataset rather than erroring. There is a test for it.

You will never get a partial load without being told why.

### Output

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

If `data/demo/` is missing you get a line saying it fell back to `src/fixtures`.
That is the temporary built-in generator, not your work — if you see that line,
your files were not found. Check `SEED_PROFILE`.

---

## 2. Serving: `pnpm start`

Startup does four things, in this order:

1. **Connect** to MongoDB (Atlas, ~3s) and confirm which database is in use.
2. **Verify indexes** exist.
3. **Load the replay script** — every transaction in timestamp order, plus every
   alert. Held in memory, ~4,972 entries.
4. **Listen** on port 4000.

```
chakravyuh api on http://localhost:4000
  database   mongodb (atlas) hackathon.gqtv7yg.mongodb.net/chakravyuh
  ml service http://localhost:8000 (3000ms timeout)
  mocks      off
  replay     4972 transactions, 3 alerts ready
```

That `replay` line is your transaction count. If it is zero or wrong, your seed
did not land.

### What each request does

A request travels the same path every time:

```
route → validate DTO → controller → repository → mapper → JSON
```

- **DTO** rejects bad input before anything touches the database, and names the
  failing fields.
- **Repository** is the only place that writes queries. Controllers never build
  one.
- **Mapper** converts the stored document into the wire shape. This is the layer
  that renames `_id` to `id`, and it is the reason `is_fraud` cannot leak: the
  domain type has no such field, so there is nothing to map it from.

Most requests are pure joins over what you seeded. Examples:

| Endpoint | What it does with your data |
|---|---|
| `GET /api/rings/:id` | Joins ring edges, member roles, identifier nodes, and `risk_v2` into one graph |
| `GET /api/alerts` | Joins each alert to its ring for `risk`, `members`, `volume` |
| `GET /api/accounts/:id` | Joins account, `signals[]`, linked identifiers, recent transactions |
| `GET /api/rings/:id/geo` | Reads `home` on members and `location` on ATM transactions |
| `GET /api/rings/:id/recruits` | Reads `recruits.json` — **never** calls Python |

### `is_fraud` is stored and never sent

You write it, it is in the database, and it is in no response. Not by policy —
the domain type does not have the field, so no mapper can emit it. A test
asserts it appears in no response, in real data and in mocks.

---

## 3. Live Python calls

Only two routes call Python, because TRD §3 permits only these two:

### `POST /taint`

Sent to `http://localhost:8000/taint`:

```json
{ "ring_id": "RING01", "victim_txn_id": "TXN003975", "as_of": "2026-10-01T10:00:00Z" }
```

Expected back:

```json
{
  "victim_amount": 48000,
  "as_of": "2026-10-01T10:00:00Z",
  "accounts": [
    { "id": "ACC0040", "balance": 120000, "tainted": 72000, "lien": 48000 }
  ],
  "lost_to_cash": 15000,
  "links": [{ "source": "ACC0040", "target": "ACC0042", "value": 48000 }]
}
```

`accounts[].tainted` must sum to `victim_amount`. The dashboard shows a
conservation line and a non-zero gap looks like a bug in the server rather than
in the model.

### `POST /mincut`

```json
{ "ring_id": "RING01", "k": 3, "exclude": ["ACC0040"], "as_of": "..." }
```

Expected back:

```json
{
  "freeze": ["ACC0040", "ACC0060", "ACC0063"],
  "at_risk_before": 1090629,
  "secured": 700771,
  "pct_stopped": 0.643
}
```

`freeze` must never contain an account from `exclude` — TRD §7.7 makes that a
hard rule, and an excluded account coming back looks to the investigator like the
tool ignored their input.

### Also present, not used by the UI

`POST /recruits` and `POST /pipeline/run` are wired but not called by any route.
Recruits are served from the database instead.

---

## 4. What happens when Python is down

This is the part worth internalising, because it fails **quietly**.

On timeout, connection refused, or any non-2xx, the server returns the ring's
stored `default_taint` / `default_freeze` with `"cached": true` and logs one
line:

```
GET /rings/RING01/taint served from cache: /taint: fetch failed
```

No route ever fails because Python is unreachable. That is deliberate — a demo
must not die because a Python process is slow.

But it means **if `/mincut` takes 4 seconds against a 3 second budget, every
freeze in the demo silently returns cached numbers and nothing looks broken.**
Check the server log for `served from cache` before the demo, or add a `/health`
check to your side.

### The cached path still respects exclusion

Python cannot re-optimise around an excluded account when it is not running, so
the freeze route recomputes `secured` and `pct_stopped` from the ring's own
stored per-account taint. Un-ticking an account still lowers the percentage:

```
k:3                             pct_stopped 0.643
k:3, exclude:["ACC0040"]        pct_stopped 0.302
k:10, exclude:[two accounts]    pct_stopped 0.129
```

Demo step 6 depends on this. It needs `default_taint` to contain per-account
entries — an empty `default_taint` gives zeroes, and the dashboard will show a
flat bar with no explanation. **This is the most likely thing to look broken if
you leave `default_taint` as `{}`.**

---

## 5. Replay

At startup the server loads every transaction in timestamp order into the replay
engine. The frontend's play button advances a virtual clock at
`REPLAY_DEFAULT_SPEED` (60× real time by default) and the server emits your
transactions as the clock passes their `ts`.

Socket events: `txn`, `alert`, `replay:clock`, `replay:state`, `replay:end`.

Things that must hold, all asserted by tests:

- **`ts` must be a real date.** A string or an epoch integer sorts wrong and the
  replay emits transactions out of order — the demo looks broken but no request
  fails.
- **Alerts fire at their `fired_at`**, in the same clock.
- **`replay:end` fires once**, after the last transaction.

REST and socket share one engine, so a presenter can always recover mid-demo:

```bash
curl -X POST localhost:4000/api/replay/start -d '{"speed":600}'
```

A full run emits ~4,972 `txn` events, 3 `alert` events, and ~25 clock ticks.

---

## 6. Things that will silently look wrong

| Symptom | Cause |
|---|---|
| Dashboard shows zeros | `default_taint` / `default_freeze` are `{}` |
| Everything 100× too big | You sent paise; the contract is rupees |
| Transactions missing | A bad `channel` — but that now errors, so check `logs |
| Replay out of order | `ts` not a real ISO date |
| Identity graph empty | `identifiers.json` missing or empty |
| Recruits panel empty | `recruits.json` missing (it is optional) |
| Geo map empty | `home` / `location` not populated |
| Freeze ignores your exclusions | `exclude` echoed back inside `freeze` |

The first two are the dangerous ones, because neither errors — they just produce
a confident, wrong dashboard.

---

## 7. Your loop

```bash
# 1. generate
python ml/generate.py --profile demo
python ml/pipeline.py --profile demo

# 2. load — read the printed counts, they should match your generator
cd server && pnpm run seed

# 3. serve
pnpm start

# 4. check
curl localhost:4000/health
curl localhost:4000/api/rings/RING01 | jq
curl -X POST localhost:4000/api/rings/RING01/freeze \
  -H 'content-type: application/json' -d '{"k":3}' | jq
```

Reference numbers from the fixture dataset: 600 accounts, 35 identifiers, ~4,972
transactions, 3 rings, 3 alerts. Yours will differ, but the ring and alert
counts should be 3 if you have planted the same demo scenario — TRD §5 describes
it.

**Compare against `cached: true`.** If every taint and freeze response says
`cached`, Python is not being reached at all and you are looking at stored
defaults, not at your model.
