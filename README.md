# Chakravyuh

Turns one flagged bank account into an investigator-ready case: the fraud ring,
each account's role, the tainted money trail, the accounts to freeze, and the
accounts likely to join next.

Everyone else flags the account. We hand the investigator the ring, the next
recruit, and the freeze order.

- `PRD.md` — the product
- `TRD.md` — the technical requirements
- `server/` — Express API, Socket.IO replay, evidence pack
- `ml/` — data generator and model pipeline *(not built yet)*
- `client/` — dashboard *(not built yet)*
- `data/` — generated data, git-ignored

All data is synthetic. Rings are planted by the team and every number in the
product is labelled as such.

## Status

| Area | Feature | State |
| --- | --- | --- |
| F6 | API and storage | done, on TypeScript and Prisma |
| F11 | Live replay over Socket.IO | done |
| F12 | Evidence pack PDF | done |
| F1 | Data generator | not started, `ml/` is empty |
| F2-F5 | Features, graph building, model, clustering | not started |
| F7 | Frontend skeleton | not started, `client/` is empty |
| F8-F10 | Taint tracing, freeze optimiser, recruit prediction | service-side contracts done, the Python implementations are not started |
| F13-F18 | Map, what-if, live pulse, health, scan, quickstart | not started |

The server is deliberately built against contract-shaped mocks and a fixture
dataset so the dashboard and the Python service can be built in parallel without
either blocking the other.

## Running it today

```bash
cd server
cp .env.example .env     # then put a real PostgreSQL URL in DATABASE_URL
npm install              # also generates the Prisma client
npm run migrate:dev      # create the schema
npm run seed             # load data/demo/ or the dev fixtures
npm start                # http://localhost:4000
```

Without a database, `USE_MOCKS=true npm start` serves the contract fixtures and
opens no connection; that is enough to build the frontend against.

```bash
cd server && npm test    # 54 checks now, 97 once DATABASE_URL is set
```

## Working in parallel

Three members, three directories.

**Member 1, server.** `server/`. Write `data/demo/*.json` and
`data/demo/outputs/*.json`, run `npm run seed`, and the API picks it up with no
code change. The exact filenames and fields are listed in `server/README.md`.

**Member 2, client.** `client/`. Run `USE_MOCKS=true npm start` in `server/` and
build against that; it opens no database connection, so it works from a fresh
clone. The payloads are committed in `server/src/mocks/payloads.ts` if you would
rather import them directly. Every response shape is in `TRD.md` section 8 and
asserted by tests against both mocks and real data, so the contract will not move
under you. The mock payloads are typed against the same TypeScript interfaces the
real routes return, so the server and the mocks cannot drift apart silently.

**Member 3, ml.** `ml/`. `generate.py` writes `data/<profile>/*.json`,
`pipeline.py` writes `data/<profile>/outputs/*.json`. Serve taint on
`POST /taint`, the freeze optimiser on `POST /mincut`, and the recruit predictor
on `POST /recruits` at `localhost:8000`, with `/health` for the check. Until
then the API serves cached defaults and says `"cached": true` in the response.

## Open questions for the team

These are recorded rather than acted on, because `PRD.md` and `TRD.md` are
shared documents and the drift is a team decision.

1. **PRD is behind TRD in three places.** TRD section 1 lists these and says to
   update the PRD if the team agrees: the evidence pack is `POST` not `GET`, the
   freeze optimiser takes an `as_of`, and the generator now produces train and
   test profiles besides the demo one. `GET /metrics` and `POST /replay/*` also
   exist in the implementation but not in the PRD contract table.
2. **MongoDB to PostgreSQL.** The team chose PostgreSQL, so TRD section 2, the
   section 6 document shapes, and `MONGO_URL` no longer match the code. The
   schema is `server/prisma/schema.prisma`, and the API now runs on TypeScript
   and Prisma rather than plain JavaScript and hand-written SQL. `MONGO_URL` is
   `DATABASE_URL`.
3. **Is the detection truly streaming?** The replay replays precomputed scores
   rather than scoring each transaction as it arrives. TRD section 9 already
   prescribes this and says to give that as the honest answer if asked, but it
   is worth a deliberate decision.
4. **Who owns the README and the pitch deck.** This README exists now; nothing
   else is written. `docs/` is empty.

## Deviations

Tracked in `server/README.md` under "Deviations from TRD". The short version:
PostgreSQL instead of MongoDB, one added `recruits` table, Express 4 pinned, and
`accounts.role` stored as a string rather than a database enum because Prisma
cannot express a value containing a hyphen.