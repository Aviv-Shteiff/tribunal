# Turn 11 — Run store on Turso/libSQL, for Render's free tier

Date: 2026-08-31
Branch: `turn-11-turso`
Commit at start: `f5fe87e`

---

## 1. Intent

Turn 10's plan needed a paid Render plan for a persistent disk, and the
deployer's card cannot use it. Swap the run store from `node:sqlite` (local
file) to `@libsql/client` / Turso (hosted libSQL, SQLite-compatible, a
genuinely free tier with no card), keeping the schema and the
`initDb`/`saveRun`/`listRuns`/`getRun` return shapes, with a local libSQL file
as the no-setup fallback for tests and `npm run dev`. Nothing outside the
persistence layer and its direct callers.

## 2. Specification

Supersedes D-014's local-SQLite choice **for the deployed environment**
(D-017); local dev keeps a libSQL *file* — same engine, same schema. `spec.md`
§6's persistence line and §9's resolved list are updated. `render.yaml` moves
to the free plan.

**Stop-and-ask, raised and answered before code.** The signatures could not
stay identical:

- **libSQL has no synchronous API.** `initDb`/`saveRun`/`listRuns`/`getRun` and
  their direct callers (`run-once.js` `persistRun`, `server.js`'s store
  accessor, `demo.js`) are now `async`. Parameter lists and return-value
  *shapes* are unchanged. Approved (a).
- **`:memory:` cannot be kept.** libSQL local mode opens a fresh connection for
  a transaction that cannot see an in-memory schema, so `saveRun` (a
  transaction) fails there. Tests use a throwaway file per test. Approved (a).
- **Schema-level test assertions** (`completed_at`, `total_cost`, `error_text`)
  are kept, ported to `db.execute`. Approved (b).
- **`render.yaml` `plan: free`.** Confirmed (c).

**Not built (still out of scope, D-016):** authentication, rate limiting,
per-caller budget.

## 3. Context supplied

Given: `CLAUDE.md`, `spec.md`, `decisions.md`, `docs/turns/turn-10.md`,
`render.yaml`, `scripts/db.js`. Read to plan: `scripts/server.js` and
`scripts/run-once.js` (db call sites), `test/db.test.js`, `test/server.test.js`,
`package.json`.

Stated constraints: `@libsql/client` only; keep the schema and the four
function signatures (stop if impossible — it was, reported, approved); local
fallback must work with zero external setup (test it, don't assume); don't
touch `src/`, the pipeline, harness, model-select, or anything outside the
persistence layer and its callers.

## 4. Plan

Approved after a spike (`@libsql/client` installed, run against a local file
and `:memory:`). Spike findings that shaped the design:

- `db.transaction('write')` + `tx.execute(...)` + `commit()`/`rollback()` gives
  the same atomicity as `node:sqlite`'s `BEGIN`/`COMMIT`; a rolled-back insert
  leaves the table unchanged.
- `PRAGMA foreign_keys = ON` on the client is honoured inside transactions on a
  file db; a bad `run_id` raises `SQLITE_CONSTRAINT`.
- A transaction's `execute()` returns `lastInsertRowid` as `undefined` → use
  `INSERT … RETURNING id` (`rows[0].id`, a JS number).
- Local URLs need a `file:` prefix (`file:db/tribunal.db`); a bare path throws
  `URL_INVALID`.
- `:memory:` + `transaction()` → "no such table" (fresh connection). Files are
  fine and persist across client instances.
- `@libsql/client` pulls ~14 packages including a native addon (`libsql`).

## 5. Execution

Files:

- `scripts/db.js` — rewritten on `@libsql/client`. `initDb(target)` resolves:
  no arg → Turso from `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`, else the local
  file (`LOCAL_DB_PATH`, `DB_PATH` to override); a `file:`/`libsql:` URL →
  as-is; a bare path → `file:`-prefixed. Schema as an array of `CREATE TABLE IF
  NOT EXISTS` run one per `execute`. `saveRun` uses one `transaction('write')`
  and `RETURNING id`. `listRuns`/`getRun` use `await db.execute({sql,args})`;
  reconstruction logic and output shapes unchanged. `id`/counts coerced with
  `Number()`.
- `scripts/run-once.js` — `persistRun` is `async` (`await initDb` / `await
  saveRun` / `await handle.close()`); dropped the `DB_PATH` import.
- `scripts/server.js` — the store accessor memoises a promise
  (`dbPromise ??= initDb(...)`); `await listRuns(await store())`, `await
  getRun(...)`, `await persistRun({..., db: await store()})`.
- `scripts/demo.js` — `await persistRun(...)`.
- `test/db.test.js` — every test `async`, a `freshDb(t)` helper opening a
  throwaway file in `os.tmpdir()` and removing it (plus `-wal`/`-shm`) in
  `t.after`. `db.prepare(...).get()/.all()` → `db.execute({sql,args})`. Added
  one test: `saveRun` is atomic (a null `reasoning` mid-transaction rolls the
  whole run back).
- `test/server.test.js` — the persistence round-trip test uses `freshDb(t)`;
  the static-asset test uses `createServer()` (those routes never open a
  store).
- `render.yaml` — `plan: free`; `disk:` and `DB_PATH` removed;
  `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` added (`sync: false`);
  `buildCommand: npm ci`.
- `.env.example` — Turso vars documented; `DB_PATH` noted as local-only.
- `README.md` "Deploying" — a "Create a free Turso database" step
  (`turso db create` / `db show --url` / `db tokens create`) before Render;
  free-plan cold-start noted.
- `docs/decisions.md` — D-017. `docs/spec.md` — §6 and §9.
- `package.json` / `package-lock.json` — `@libsql/client` added; the lockfile
  now exists.

Nothing outside the persistence layer and its callers was touched. `src/`, the
pipeline, harness, model-select, validate/retry — untouched.

## 6. Verification

`npm test` — 105 tests, 105 pass, 0 fail (was 104; +1 atomicity test).

| Check | Method | Result |
|---|---|---|
| Existing db tests pass against the local libSQL file | `npm test` (`test/db.test.js`, throwaway files) | pass |
| Schema-level assertions kept (`completed_at`, `total_cost`, `error_text`) | ported to `db.execute` | pass |
| `saveRun` atomic — bad child insert rolls the run back | new `test/db.test.js` case | pass |
| Server persist → `GET /runs` → `GET /runs/:id` round trip | `test/server.test.js` against a throwaway file | pass |
| Local fallback works with zero setup | started `npm start`-equivalent with no `.env`, no Turso vars: `db/tribunal.db` created, `GET /runs` → `{"ok":true,"runs":[]}`, `GET /runs/1` → 404 | pass |
| `initDb` picks Turso when the env vars are set | code path review (`clientConfig`); the Turso branch is `createClient({ url, authToken })` | pass (code) |
| Transaction / FK / `RETURNING id` behaviour matches `node:sqlite` | spike against a local file | pass |
| No `src/` / pipeline / harness change | `git diff --stat` | pass |

**Not verified — no way to here:**

- **A real Turso connection.** No auth token in this environment; the hosted
  path (`createClient({ url: 'libsql://…', authToken })`), and FK enforcement
  on Turso specifically, are unproven until the manual deploy.
- **`npm ci` on a real Render build** with the native `libsql` prebuild for
  linux-x64.

## 7. Audit trail

Commits in this turn:
- `<sha>` — `@libsql/client` + `scripts/db.js` rewrite (async, libSQL)
- `<sha>` — thread async through `persistRun` / server store / `demo.js`
- `<sha>` — tests on the local libSQL file (throwaway files, contract-level)
- `<sha>` — `render.yaml` free plan + Turso, `.env.example`, README
- (this commit) — docs: D-017, `spec.md` §6/§9, this record

Model calls: none. Cost incurred: $0.00.

**Locked this turn:** `spec.md` §6 now names libSQL/Turso.

**Left open:**
- The real Turso connection and a real Render build — the manual deploy.
- D-016's public-instance risks — unchanged (auth, rate limiting, cumulative
  spend).
- Modality filter (turn 4), mid-run abort (turn 5), the unshown `calls` log
  (turn 8), `npm run lint` — still open.

**Rules written into `CLAUDE.md` this turn:** none.

**Milestone:** the run store is a hosted database on a free tier — the project
can deploy on Render's free plan with no payment method, and the zero-
dependency era is over (one dependency, `@libsql/client`, stated plainly in
D-017).
