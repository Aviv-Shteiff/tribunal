# Turn 08 — A real database, and a past-runs view

Date: 2026-08-29
Branch: `turn-08-database`
Commit at start: `251b562`

---

## 1. Intent

Meet the course requirement that the system keep every charge sheet, its
opinions, and a log of every model call in something you can query — not a
git-ignored pile of JSON files a fresh clone can't see or list. Replace
`runs/*.json` with a local SQLite database at the one existing persist point,
and add a read-only page that lists past runs and opens any one in the turn-6
detail rendering.

## 2. Specification

Resolves `spec.md` §9's open "Persistence: local JSON files or Supabase" to a
local SQLite database via `node:sqlite` (D-014); §6's "persisted and listable"
locked line now names the store. `spec.md` §8 (no auth) and the pipeline are
unchanged.

**Contract change, approved beforehand.** The `POST /run` response field
`runFile` becomes `runId` (the database id; `null` when persistence is off).
Turn 8 also adds read-only `GET /runs` and `GET /runs/:id`. `verdicts[]` loses
`key_factors` (never rendered; not in the schema).

**Node version, flagged before building.** `engines.node` was `">=22"`, which
does not guarantee `node:sqlite` (it landed in 22.5) and it is still
experimental on Node 24. Raised to `">=22.6.0"`; `test`/`dev`/`demo` pass
`--disable-warning=ExperimentalWarning`. Not a fallback to another library —
`node:sqlite` is used, verified working (`:memory:` insert/select/aggregate/FK/
transaction) on the installed Node 24.12.

**Schema shown and approved before creation.** Four tables — `runs`,
`verdicts`, `speeches`, `calls`. One `calls` row per model call. Nullable
columns hold `NULL` when the API reported no value; nothing is estimated to
fill them. On the user's instruction, `calls.error_text` was added back (the
failure message on a failed call) and `verdicts.key_factors` dropped.

**Where speeches land:** a `speeches` table beside `verdicts`, not on `calls`
and not on `runs` — reasoning in §2 of the plan and D-014. A representative
may take two `calls` (the retry) but yields one accepted speech.

**Existing `runs/*.json` (turns 3–7):** left as-is, not migrated. Several are
`npm test` litter with fabricated costs; `docs/findings.md` records the real
runs. Decided with the user.

## 3. Context supplied

Given: `CLAUDE.md`, `spec.md`, `decisions.md`, `findings.md`, the current write
path (`run-once.js` `writeRunRecord`, called from `server.js` and `demo.js`),
and a verbatim lecture excerpt naming the database, the call log, and a
past-cases page as the requirement.

Stated constraints: `node:sqlite` only, no dependency; don't touch
`pipeline.js` model-calling, the harness, `model-select`, `validate`/`retry`;
no auth, no multi-user, no search/filtering beyond a chronological list; plan +
exact schema first, wait for approval; raise the migration question and any
response-shape change.

## 4. Plan

Approved with one change: keep `calls.error_text`, drop `verdicts.key_factors`.

1. Branch `turn-08-database`.
2. `package.json` — engines `>=22.6.0`; `--disable-warning=ExperimentalWarning`
   in the three scripts. `.gitignore` — add `db/`.
3. `scripts/db.js` — `initDb` (idempotent `CREATE TABLE IF NOT EXISTS`),
   `saveRun` (one transaction, returns the run id), `listRuns`, `getRun`
   (rebuilds the `POST /run` shape).
4. `scripts/run-once.js` — `writeRunRecord` → `persistRun` (delegates to
   `saveRun`); `executeRun` also returns `startedAt`.
5. `scripts/server.js` — persist via `persistRun`; lazy-open one db handle;
   routes `GET /past`, `GET /runs`, `GET /runs/:id`, `GET /render.js`,
   `GET /style.css`; `runFile` → `runId`.
6. `scripts/demo.js` — `persistRun`; prints `run #<id>`.
7. `public/render.js`, `public/style.css` — the turn-6 rendering and styles,
   extracted so both pages share them, no duplication.
8. `public/index.html` — link the extracted assets; add a "Past runs" link.
9. `public/runs.html` — the list + click-to-open detail, using `render.js`.
10. `test/db.test.js` — schema creation, write-then-read per table, `listRuns`,
    `getRun`, all against `:memory:`. `test/server.test.js` — `runFile` →
    `runId`; the persistence test round-trips through `GET /runs` + `/runs/:id`
    against an in-memory db.
11. `npm test`; one real Mode A run over the endpoint; read it back.
12. `spec.md` §6/§9, `decisions.md` D-014, this record. Commit per change; do
    not merge.

## 5. Execution

Followed the plan. `src/` untouched. `writeRunRecord` and every `runs/*.json`
write path are gone — `saveRun` is the only insert, in one transaction, called
by `persistRun` (CLI: open/save/close) and by the server (one held handle).

CSS was extracted to `public/style.css` alongside `render.js` — not in the
literal plan, but the alternative was duplicating ~75 lines of styles across
`index.html` and `runs.html`, which the render.js extraction was already there
to avoid.

The past-runs **detail** view renders exactly turn 6's output (verdicts,
speeches, rep table, two-tier summary). The per-call log is persisted in
`calls` and queryable, but not rendered as a table — that would be UI beyond
"the same rendering turn 6 built". Flagged here in case a later turn wants it.

`npm test`: 94 → 104. No `ExperimentalWarning` in the output (the flag works).
No `db/` directory is created by the test run — the server opens its handle
lazily and every test passes an in-memory db or never touches the store.

**Live run** — `npm run dev` with `DEMO_MODEL_ID=openai/gpt-oss-20b`, then
`POST /run` Mode A against the fixture charge sheet:

- Response: `runId: 1`, mode A, 3 verdicts (all not justified), 4
  representatives ok, 8 calls (one `tyrion_lannister` retry), **$0.00139557**,
  `stopped: false`. `db/tribunal.db` created and git-ignored.
- `GET /runs` → one row: `{ id: 1, started_at, mode: "A",
  model_source: "DEMO_MODEL_ID", total_cost: 0.00139557,
  verdict_summary: "not justified ×3" }`.
- `GET /runs/1` → the full `POST /run` shape rebuilt from the rows: verdicts
  with markdown-bearing reasoning intact, four speech texts (227–2562 chars),
  `judges.completed` = all three, `totals` re-summed from `calls`
  (12,761 + 7,191 = 19,952 tokens; $0.00139557; 8 calls), `wallClockMs` 92,126
  from `completed_at − started_at`.
- Direct DB check: `runs` 1, `verdicts` 3, `speeches` 4, `calls` 8. The
  `tyrion_lannister` attempt-1 row has `validation_outcome = 'invalid'` and
  `error_text = "response was not valid JSON: Unterminated string in JSON at
  position 1923…"` — the column earns its place.

Total real spend this turn: **$0.00139557**, one run.

## 6. Verification

`npm test` — 104 tests, 104 pass, 0 fail.

| Check | Method | Result |
|---|---|---|
| `initDb` creates the four tables | `db.test.js` (`sqlite_master`) | pass |
| Write-then-read round trip per table | `db.test.js` — `saveRun` then raw `SELECT` on runs / verdicts / speeches / calls | pass |
| `calls` store `NULL` tokens/cost and the `error_text` for a failed call | `db.test.js` | pass |
| `listRuns` — newest first, verdict summary, "N of 3" when a judge failed | `db.test.js` | pass |
| `getRun` rebuilds the `POST /run` shape; judge failed vs not-attempted; `null` for an unknown id | `db.test.js` | pass |
| A stopped run round-trips its flag and reason | `db.test.js` | pass |
| `POST /run` returns `runId`; `persist:false` → `runId: null` | `server.test.js` | pass |
| Persist, then `GET /runs` and `GET /runs/:id` read it back (in-memory db) | `server.test.js` | pass |
| `GET /past`, `/render.js`, `/style.css` served | `server.test.js` | pass |
| `GET /` still serves the page, charge sheet injected, placeholder gone | `server.test.js` | pass |
| One real Mode A run persists and reads back end to end | `npm run dev` + curl | pass — $0.00139557, run #1 |
| `src/`, harness, model-select, validate/retry untouched | `git diff --stat` | pass |
| `node:sqlite` supported on the pinned engine | `>=22.6.0`; probed insert/select/FK/txn on Node 24.12 | pass |

**Not verified, and why:**

- **The pages in a real browser.** No headless browser here. Verified by
  driving `GET /runs` and `GET /runs/:id` (what `runs.html` fetches) and by
  serving each asset; the DOM assembly reuses turn 6's `showResults`.
- **A stored *Mode B* run's detail view.** Only a Mode A run was persisted this
  turn; `getRun`'s shaping is mode-agnostic and covered for both by
  `db.test.js`.
- **Schema migration beyond first-create.** There is one schema version and
  `CREATE TABLE IF NOT EXISTS`; no ALTER path exists or is needed yet.
- **Concurrent writers.** One local process; no locking tested.

## 7. Audit trail

Commits in this turn:
- `8d272cf` — SQLite store: `scripts/db.js`, engines bump, `.gitignore`
- `c9aa17d` — persist through the database at the one write point (`run-once.js`, `server.js`, `demo.js`)
- `91e824d` — past-runs page: `render.js` / `style.css` extraction, `runs.html`, `index.html` link
- `f1d5ba5` — tests: `db.test.js`, `server.test.js` updates
- (this commit) — docs: `spec.md` §6/§9, D-014, this record

Model calls: one real Mode A run of 8 calls. Cost incurred: **$0.00139557**.

**Locked this turn:** `spec.md` §6 names the store; §9's persistence item is
resolved (D-014).

**Left open:**
- The `calls` log is persisted but not shown in the UI — a later turn could
  add a per-call table to the detail view.
- Modality filter (turn 4), mid-run abort (turn 5) — still open.
- `npm run lint` — still documented in `CLAUDE.md`, still not implemented.

**Rules written into `CLAUDE.md` this turn:** none. No correction was issued.

**Milestone:** a past case can be found — the tribunal's runs, opinions, and
full call log live in a queryable database, and a read-only page lists them and
opens any one.
