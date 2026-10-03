# Fund-flow persistence — implementation and verification

**3 Oct 2026.** Backend persistence is implemented and tested. Verification of
the actual ML demo artifact remains pending because
`data/demo/outputs/fund_flows.json` was absent from the checkout.

## 1. Implementation inventory

| File | Change |
| --- | --- |
| `server/src/interfaces/fund_flow.interface.ts` | Added artifact types for the summary, paths and chain steps |
| `server/src/models/fund_flow.model.ts` | Added path and summary models, validation and indexes |
| `server/src/repositories/fund_flows.repository.ts` | Added session-aware summary upsert and batched path insertion |
| `server/src/models/index.ts` | Registered both models in `ALL_MODELS`, including index creation and truncation |
| `server/src/services/seed.service.ts` | Reads the optional artifact and writes it within the existing seed transaction |
| `server/test/fund_flows.test.ts` | Added 15 database-backed tests |

The change is additive persistence. Existing domain schemas, public API shapes,
routes, controllers and socket handlers were not changed. ML and frontend files
were not modified. API exposure is a separate task.

## 2. Storage and seed behavior

- **`fund_flow_paths`:** one document per path, deterministic string
  `_id = path_id`, with the ordered chain embedded in that document.
- **`fund_flow_summaries`:** one document
  `{ _id: "main", profile, summary: { ... } }` for the current seed/profile.
- Path start/end times and chain timestamps are MongoDB Dates. Account and
  transaction references are strings. Embedded steps and summary have no `_id`.
- Amounts stay in integer paise. `amount_decay_pct` is preserved as the ML
  engine's nominal transaction amount difference, including negative values;
  it is not a loss/provenance or taint calculation. No ring/role fields are added.
- Both collections are cleared by the existing `truncateAll()` and written in
  the same transaction as accounts, rings, transactions and other outputs.
- Paths use the shared 1,000-document batch helper and explicit validation.
  A later batch failure rolls back earlier batches, the summary and other seed
  writes.
- Missing file: both collections are empty after a successful reseed. Empty
  `paths`: the supplied summary is still stored. Malformed JSON uses the
  existing loader error, including the filename.
- Summary fields, including `truncated` and `total_paths_identified`, are stored
  as supplied; the reported total is not derived from stored path count.

Full schema: [ML_INTEGRATION.md §3.9](../ML_INTEGRATION.md#39-outputsfund_flowsjson--optional-object).

### Indexes

| Collection | Indexes |
| --- | --- |
| `fund_flow_paths` | Default unique `_id`; ascending `start_time`, `chain.from_account`, `chain.to_account`, `chain.txn_id` |
| `fund_flow_summaries` | Default unique `_id` only |

The additional indexes support time-window scans and paths containing a named
account or transaction. There are no additional compound indexes.

## 3. Test results

Run from `server/`:

```bash
pnpm run typecheck
MONGO_URL=placeholder TEST_MONGO_URL= ML_URL=http://127.0.0.1:1 pnpm test
```

The environment overrides make the suite start its own replica set and keep
Python unreachable for the existing fallback tests. They do not edit `.env`.

```text
typecheck     passed
collections   10 ready
test files    13 passed
tests         145 passed, 0 failed, 0 skipped
duration      11.69 seconds reported by Vitest
```

**Regression: 130 existing tests passed. Fund flows: 15 new tests passed.**
The older 103/117 counts in earlier reports refer to earlier code snapshots.

### New checks

1. Existing JSON loader reads a valid artifact.
2. One document per path; deterministic ids, Date storage, exact paise and
   nominal-decay preservation, and no invented fields/subdocument ids.
3. Supplied summary and current profile persist in a single document.
4. Repeated seed creates no duplicates.
5. Smaller reseed removes old paths and replaces values.
6. `truncated: true` and a reported total different from `paths.length` survive.
7. Empty paths preserve the summary and nullable fastest-path value.
8. Missing optional file clears both previous fund-flow collections.
9. Fixture-mode reseed clears fund flows through the same registry lifecycle.
10. Profile switching replaces the current summary.
11. Malformed JSON preserves the previous seed and reports the filename.
12. Invalid summary rolls back truncation and writes.
13. Invalid chain amount in path 1,001 rolls back the first batch, the summary,
    earlier account writes and the seed metadata deletion.
14. Invalid chain timestamp is rejected without replacing previous paths.
15. The intended path and summary indexes exist.

**Runner note:** after reporting all tests passed, Vitest printed a
`close timed out after 10000ms` warning about two Vite servers. The command
exited successfully. The warning's cause was not investigated in this task.

## 4. Demo seed verification

The existing CLI was invoked twice with `SEED_FIXTURES=false` against the real
`data/demo/` files. A temporary single-node MongoDB replica set provided the
isolated database `chakravyuh_seed_verification`; it was stopped afterwards.
The development database was not the target.

Each invocation was equivalent to the following, with `MONGO_URL` set by the
verification harness to that temporary replica set:

```bash
SEED_FIXTURES=false SEED_PROFILE=demo pnpm run seed demo
```

| Collection | First seed | Second seed |
| --- | ---: | ---: |
| `accounts` | 926 | 926 |
| `identifiers` | 475 | 475 |
| `transactions` | 8,041 | 8,041 |
| `rings` | 3 | 3 |
| `alerts` | 3 | 3 |
| `fund_flow_paths` | 0 | 0 |
| `fund_flow_summaries` | 0 | 0 |

The zero fund-flow counts are expected for the **missing optional file**.
There was no summary from which to verify the actual artifact's `truncated`
value. The populated test artifacts established those behaviors, but they are
not evidence that the real 1,000-path ML artifact has been imported.

The temporary verification script was removed after the run. `git diff --check`
also passed.

## 5. Completing real-artifact verification

Once `data/demo/outputs/fund_flows.json` is available alongside the complete
exported profile, an intentional file-based reseed uses
`SEED_FIXTURES=false pnpm run seed demo` from `server/` against the chosen
MongoDB replica set. This replaces all registered collections. The existing
default `SEED_FIXTURES=true` selects built-in fixtures, even when files exist.

The CLI's existing count output covers the original five collections. Check the
new collections in a Mongo shell connected to the same database:

```javascript
db.fund_flow_paths.countDocuments({})
db.fund_flow_summaries.countDocuments({})
db.fund_flow_summaries.findOne({ _id: "main" })
db.fund_flow_paths.distinct("_id").length
```

Expected with a valid artifact: path count equals the file's `paths.length`,
one summary with the selected profile, and its complete `summary` equals the
file's summary. Repeat the seed and confirm identical counts and values.
Compare against `paths.length`, not `summary.total_paths_identified`, which is
preserved independently, particularly for truncated results.
