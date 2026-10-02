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

## Repo layout

```
server/   Member 1. Express + TypeScript + Mongoose 9 on MongoDB.
ml/       Member 3. Python pipeline. Currently EMPTY.
client/   Member 2. Frontend.
docs/     Integration docs for all three.
```

`ml/` and `client/` are owned by other members. Do not write into them without
being asked — `server/src/mocks/` and `server/data/demo/` exist so those teams
are not blocked while their side is empty.

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