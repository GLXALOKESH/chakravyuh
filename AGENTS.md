# AGENTS.md

Instructions for AI agents working in this repo. Read before touching anything.

## Package manager: pnpm, always

**Use `pnpm`, never `npm` or `yarn`.** The user works in pnpm across all Node
projects.

| Do | Don't |
| --- | --- |
| `pnpm install` | `npm install` |
| `pnpm test` | `npm test` |
| `pnpm run build` | `npm run build` |
| `pnpm add <pkg>` | `npm install <pkg>` |
| `pnpm dlx <tool>` | `npx <tool>` |

Lockfiles are `pnpm-lock.yaml` in both `server/` and `client/`. Do not create or
commit a `package-lock.json`.

Use `pnpm add -D` for devDependencies and `pnpm add` for runtime ones, so
dependencies land in the right `dependencies` block.

## Git: read-only unless explicitly told otherwise

**Never run `git commit`, `git add`, `git stash`, `git push`, `git rebase`,
`git reset`, or any other write operation without the user asking for it in that
moment.** Read-only commands — `git status`, `git log`, `git diff`,
`git show`, `git ls-files` — are fine.

Leave every change uncommitted in the working tree and let the user stage it.

## Credentials

`server/.env` holds a real MongoDB Atlas connection string and is gitignored.
Never print credentials, never copy them into a file that gets committed, and
mask the userinfo section when echoing a connection string:

```bash
# safe
sed -E 's|(mongodb(\+srv)?://)([^:/@]+):([^@]+)@|\1\3:***@|' .env

# unsafe — do not
cat .env
```

## Scope: server only

**Work only in `server/`. Never modify `ml/` or `client/`.** Another person owns
the Python pipeline and another owns the frontend. Do not edit, refactor,
reformat, "fix", delete or commit anything in either directory — even when a
problem there looks obviously wrong and even when it blocks the server.

When a problem is found on the other side:

1. **Report it to the user in your reply.** Do not act on it.
2. Say which file, what the mismatch is, and which side the server expects.
3. Let them decide. They own the conversation with the other member.

This is not a soft preference. Editing another member's work to "help" causes
merge conflicts in work they have already pushed, and it hides decisions that
are theirs to make.

## Repo layout

```
server/   Member 1, OURS. Express + TypeScript + Mongoose 9 on MongoDB.
ml/       Member 3. Python pipeline. NOT OURS.
client/   Member 2. Frontend. NOT OURS.
docs/     Integration docs. Ours to write when a contract needs stating.
```

Read-only across the boundary: reading `ml/` to understand what the server is
called with is fine and often necessary. Writing to it is not.

## Docs

`docs/` is the integration surface:

| File | Purpose |
| --- | --- |
| `BACKEND_STATUS.md` | What is built, decisions, what is not done |
| `COMMUNICATION.md` | How frontend and ML talk to the server |
| `ML_INTEGRATION.md` | File formats and endpoints for Member 3 |
| `ML_PIPELINE_FLOW.md` | The Python pipeline, step by step |
| `HOW_DATA_FLOWS.md` | What the server does after the seed |

`PRD.md` and `TRD.md` are shared team documents. **Do not edit them.** Where the
implementation drifts from them, record the drift in `docs/BACKEND_STATUS.md`
under "Known PRD/TRD drift" and let the team decide.

TRD is the newer document and the implementation follows it.

## Testing

```bash
cd server
pnpm test
```

Needs no database — `test/global-setup.ts` starts its own single-node replica set
in-process when `MONGO_URL` is unset. With a URL set, it uses a separate
database called `chakravyuh_test` on the same cluster, because the suite clears
collections.

Against Atlas a seed takes ~40s versus <1s locally, which is why
`testTimeout` is 180s. Do not lower it.

Current state: 103 checks, 8 files, nothing skipped. The suite catching zero
tests is a bug — if a run reports 0 or a suspiciously low count, investigate
rather than accepting it.

## Current state and known issues

**`docs/PROJECT_STATUS.md` is the source of truth for what is true right now.**
Read it before answering anything about progress. `docs/BACKEND_STATUS.md`
explains the design; `docs/API_FOR_FRONTEND.md` is the endpoint reference;
`docs/tests/` holds measured benchmarks and test reports.

As of 3 Oct 2026:

- Server: complete. 15 endpoints, 117 tests, passing against both Atlas and a
  local MongoDB replica set.
- ML pipeline: 17 modules, ~7,500 lines, 33 tests passing. The venv is
  `ml/.venv/` with 38 packages installed from `ml/requirements.txt`.
- **xgboost needs `brew install libomp`** — a system library, not a pip package.
  Without it `ml/models.py` imports fine and then fails at `XGBClassifier.fit()`,
  because the import is guarded by `try/except`.
- The database is a **local replica set** (`rs0`, `server/.mongorc-local`).
  Atlas credentials are preserved in `server/.env.atlas-backup`; restore with
  `cp server/.env.atlas-backup server/.env`.
- **Do not run `pnpm run seed`.** The ML team pushes directly to the database;
  seeding would truncate their collections and load fixtures over the top. After
  a push, run `pnpm run db:indexes` only.
- Run ML tests from the **repo root**, not `ml/` — they import `from ml.x`.
- `ml-fallback.test.ts`, `pipeline.test.ts` and `freeze-edge.test.ts` need the ML
  service **stopped**; they assert the degraded path. The suite seeds
  `chakravyuh_test` from fixtures while a running service loads the pipeline's
  `data/demo`, and the two datasets share ring ids but nothing else.

## Unit conversions must not guess

Fixed 3 Oct 2026 in `ml/run.py` and `ml/service.py`. Both converted paise to
rupees using a magnitude threshold (`int(v) // 100 if int(v) > N else int(v)`),
which split a single response across two currencies and broke TRD §7.6 taint
conservation by up to 257,214.

`trace()` is unconditionally paise, so the unit is known and the conversion must
be unconditional. Both sites now share one `paise_to_rupees` that also rounds
rather than truncates. **Never reintroduce a threshold on a unit conversion** —
assert the unit is known and convert everything.

`ml/tests/test_taint_conservation.py` guards this.

Open issues are listed in `docs/PROJECT_STATUS.md` § Open issues. Most are on the
ML side — report them, do not act on them.