# Turn 10 — Prepared for deployment on Render

Date: 2026-08-31
Branch: `turn-10-deploy`
Commit at start: `c9e043f`

---

## 1. Intent

The lecture (module 7) names deployment for this project: "deployment is what
lets someone else open the Tribunal at a web address and put a case."
Everything so far runs only on localhost. This turn makes the server
deployable on Render — bind, database path, blueprint, and instructions — and
names the risks of a public instance. It does not deploy anything (a manual
dashboard step) and does not touch the pipeline, harness, or database schema.

## 2. Specification

Resolves `spec.md` §9's `[OPEN] Deployment target` to Render. `decisions.md`
gains D-016 (the deployment config and the open public-exposure risks). No
locked section changes.

Constraints from the brief, all met:

- **Ephemeral filesystem.** Render loses disk contents on restart/redeploy
  unless a disk is attached. `render.yaml` attaches a 1 GB disk at `/var/data`;
  `DB_PATH` points the SQLite file at `/var/data/tribunal.db`.
- **Port/host binding.** `scripts/server.js` already read `process.env.PORT`
  (fallback 3000); the change is the bind host, `127.0.0.1` → `0.0.0.0`.
- **Secrets from the environment.** `OPENROUTER_API_KEY` and `RUN_BUDGET_USD`
  are listed in `render.yaml` by name only (`sync: false`); `.env` stays
  git-ignored.
- **Public spend risk named, not solved.** The budget gate is per-run, not
  cumulative; D-016 spells this out along with the absence of auth, rate
  limiting, and per-caller caps.

**Not built (out of scope by instruction):** authentication, rate limiting,
per-user budget tracking — recorded as open risks in D-016 instead.

## 3. Context supplied

Given: `CLAUDE.md`, `spec.md`, `decisions.md`. Read to answer the brief:
`scripts/server.js` (binding), `scripts/db.js` (`DB_PATH`), `README.md`,
`package.json`, `.gitignore`, `test/server.test.js` (how tests start the
server).

Stated constraints: prepare only, do not deploy; no pipeline/harness/schema
change; confirm the disk mount path and the exact env var names before
building; stop and ask if the binding turned out entangled with tests.

## 4. Plan

Approved. The entanglement check was reported and cleared before approval:

- `scripts/server.js` — the `.listen()` call is inside `if (invokedDirectly)`,
  which `node --test` never runs; every server test calls
  `server.listen(0, '127.0.0.1', …)` itself. Changing the bind host touches no
  test.
- `scripts/db.js` — tests pass `':memory:'` or hit routes that never open a
  database; none set `DB_PATH`.

Both are one-line changes, not a refactor.

Approved specifics: mount path `/var/data`; `DB_PATH` wired with a value in
`render.yaml` (not name-only); `DEMO_MODEL_ID` included in the blueprint;
`plan: starter`.

## 5. Execution

Followed the plan. Files:

- `scripts/server.js` — bind host `0.0.0.0`; header comment updated (it still
  claimed "Bound to 127.0.0.1 … local use only").
- `scripts/db.js` — `DB_PATH = process.env.DB_PATH || <local default>`; comment
  updated.
- `package.json` — added `"start": "node --disable-warning=ExperimentalWarning
  scripts/server.js"` (no `--env-file`: Render injects env vars into the
  process and there is no `.env` in the deploy).
- `render.yaml` — new, repo root. One web service (`tribunal`, `runtime: node`,
  `plan: starter`, `numInstances: 1`), `buildCommand: npm install`,
  `startCommand: npm start`, `healthCheckPath: /`, the four env vars
  (`OPENROUTER_API_KEY` / `RUN_BUDGET_USD` / `DEMO_MODEL_ID` as `sync: false`,
  `DB_PATH` value `/var/data/tribunal.db`), and a 1 GB disk at `/var/data`.
  No env var value except the disk path is in the file.
- `.env.example` — commented `DEMO_MODEL_ID` and `DB_PATH` lines documenting
  the overrides.
- `README.md` — a "Deploying" section: create the Blueprint, set the secret
  env vars, deploy; and a pointer to D-016 before making the URL public.
- `docs/decisions.md` — D-016.
- `docs/spec.md` — §9 deployment item moved to "Resolved".

Nothing was added that was not asked for. Zero dependencies (there were none;
`npm install` in `buildCommand` is a no-op and needs no lockfile).

## 6. Verification

`npm test` — 104 tests, 104 pass, 0 fail (unchanged; the config changes
default to the previous behaviour for local dev).

| Check | Method | Result |
|---|---|---|
| Existing suite still green with the port/DB-path changes | `npm test` | pass — 104/104 |
| `npm start` (no `--env-file`) starts the server | ran `node … scripts/server.js` with `PORT=3111` | pass — "Tribunal UI on …3111", `GET /` → 200 |
| `PORT` env honoured | started with `PORT=3111`; served on 3111 | pass |
| `DB_PATH` env honoured | started with `DB_PATH=/tmp/…check.db`; the file was created there, not in `db/`; `GET /runs` → `{"ok":true,"runs":[]}` | pass |
| Bind host is `0.0.0.0` | code change is `.listen(port, '0.0.0.0', …)`; server answered on `127.0.0.1` (a subset of `0.0.0.0`) | pass |
| No secret value in the repo | `render.yaml` reviewed — only `DB_PATH`'s mount path has a value; `.env` still git-ignored | pass |
| `render.yaml` matches the approved shape | diff against the plan | pass |
| No `src/` / pipeline / harness / schema change | `git diff --stat` | pass |

**Not verified — and cannot be here:** an actual Render deploy. The blueprint
is written to Render's Blueprint spec but has not been run through Render;
`render.yaml` syntax, the disk attach, and a live start on Render are unproven
until the manual deploy. The README frames every step as manual.

## 7. Audit trail

Commits in this turn:
- `<sha>` — bind `0.0.0.0` on `PORT`, `DB_PATH` from env, `start` script
- `<sha>` — `render.yaml`, `.env.example`, README "Deploying"
- (this commit) — docs: D-016, `spec.md` §9, this record

Model calls: none. Cost incurred: $0.00.

**Locked this turn:** nothing in `spec.md`; §9's deployment item is resolved
(D-016).

**Left open:**
- **The deploy itself** — a manual Render dashboard step.
- **Public-instance risks** — unbounded cumulative spend, no auth, no rate
  limiting, no per-caller cap (D-016). Named, not mitigated, by instruction.
- **Single instance only** — SQLite + one disk + the in-process run lock;
  `numInstances` must stay 1.
- Modality filter (turn 4), mid-run abort (turn 5), the unshown `calls` log
  (turn 8), `npm run lint` — still open.

**Rules written into `CLAUDE.md` this turn:** none.

**Milestone:** the server can run on a host, not just localhost — it binds
`0.0.0.0` on the injected port, keeps its database on a configurable path, and
ships a Render blueprint plus the steps to deploy it.
