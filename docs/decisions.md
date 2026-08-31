# Decisions

Why things are the way they are. The agent can read the code; it cannot read
the reasoning. One entry per decision, newest at the bottom.

---

## D-001 — The charge sheet is runtime input, not built-in content

The case supplied by the course describes itself as a canonical example for the
running project. Treating it as the system's content would make the app a
single-case demo. Treating it as input makes the system a tribunal that accepts
any case, with the supplied case as its reference fixture.

Consequence: the case text lives in `fixtures/`, and nothing in `src/` may
import it.

## D-002 — Per-agent models are fixed, not random

An observed implementation offered "random per agent". Randomising the mapping
means two runs differ in both persona and model, so no comparison isolates
either. The point of Mode B is to ask whether character survives a change of
model, which requires the mapping to hold still.

## D-003 — Verdict is a closed two-value field

An observed implementation let judges return "Not Guilty", "Not Guilty" and
"Justifiable Homicide" for one case. Those are not the same question. The
course case sets the issue as justified / not justified, so the field is
constrained to those two strings and validated in code. Every decision fixed
here is one the model does not get to guess.

## D-004 — No aggregation of verdicts

The scope note in the course case says the tribunal decides and gives reasons,
does not sentence, and does not combine opinions. A majority count would also
imply the three judges are interchangeable measurements of one thing, when the
project's whole subject is that they differ.

## D-005 — Verification targets the harness, not the reasoning

Two questions get confused: does the code do what the spec required, and does
the model reason well. Only the first is verifiable here. So the tests cover
schema validation, retry, isolation, budget enforcement and protocol accuracy —
and deliberately assert nothing about what a judge concluded.

## D-006 — Budget is a gate, not a display

A number on screen does not stop a run. The cap is checked before each call and
aborts the run. The day the check is skipped is the day it was needed.

## D-007 — Model names are never hardcoded

Free-tier model availability on OpenRouter changes frequently, and any name
written into source today is a stale name later. The list is fetched at startup
and filtered by advertised price.

## D-008 — Sequential calls until the gate can survive concurrency

Two locked sections disagree. §3 runs the four representatives in parallel and
then the three judges in parallel. §6 requires the running total to be checked
before each call and the run to stop when the next call could exceed the cap.
Those hold together only while one call is in flight at a time: fire four at
once and all four read the same total, all four pass, and the cap is discovered
already broken.

The harness in turn 2 has no agents in it, so nothing was gained by racing.
Given a gate that works and parallelism that does not, and a cap whose whole
point is that it cannot be exceeded, the gate wins. Calls are made one at a
time and `run-harness.js` says so in a comment.

This is a deferral, not a resolution. Parallelism is worth real time — seven
calls in sequence is seven round trips — and the right fix is probably to
reserve against the cap before dispatch rather than to check after. That work
belongs to the turn that adds the personas, because only then is there a stage
worth parallelising and a real cost per call to reserve. Recorded as [OPEN] in
spec.md §9 so it is resolved deliberately rather than discovered.

## D-009 — Sequential calls, permanently

Turn 3 built the pipeline and had to settle the D-008 deferral. The three
options were: make the gate concurrency-safe by reserving against the cap
before dispatch; drop the parallelism; or batch each stage under one
reservation. Sequential is now locked.

Reserving before dispatch means reserving the *maximum possible* cost of a
call — a local estimate, which §6 forbids. Batching has the same problem. That
leaves dropping the parallelism, and the cost of doing so is small: the first
real run took 65 s for seven sequential calls, there is no UI waiting on it,
and streaming is excluded (§8). The experiment compares persona reasoning
across models, not throughput.

Consequence: §3's diagram says "in sequence"; `pipeline.js` and
`run-harness.js` no longer carry "until the pipeline is built" caveats. Revisit
only if a UI with a concrete latency requirement appears — at which point the
reserve-before-dispatch design is the starting point, and it needs a way to
bound a call's cost without estimating it.

## D-010 — Representative speeches are capped at 2,000 tokens

spec.md §9 left max speech length open, to be set once a real run reported
token counts. The first run did: representative speeches came back at 435, 471,
1,581 and 516 completion tokens.

A cap matters because the experiment compares personas across models, and a
model that writes three times as much changes what every judge downstream
reads — the comparison stops being clean. 2,000 tokens sits above the observed
ceiling with headroom, and holds the worst case (charge sheet ~1,100 + four
capped speeches + persona and contract ~1,100 ≈ 10,200 tokens) under
`model-select.js`'s 12,000-token context floor, so that floor stays a real
guarantee rather than a number to raise.

Judges are left uncapped: a verdict's reasoning is the output of the run, the
longest observed was 1,096 tokens, and nothing downstream consumes it.

Consequence: `pipeline.js` sets `maxTokens: MAX_SPEECH_TOKENS` on representative
requests only; `callModel` passes it through as `max_tokens` and omits the
field entirely when unset.

## D-011 — Mode B maps each agent to its own model, and never shares one

spec.md §4 fixes that Mode B binds each agent to a specific model by a
deterministic mapping. Turn 4 built it as `buildModelMap`: the seven agents are
walked in a fixed order (representatives then judges, `personas.js` order) and
each is given the cheapest not-yet-used model from the live list that clears its
role's context floor — the same price-then-context rule Mode A uses for its one
model.

Two sub-decisions the spec left open:

- **Representative context floor.** Judges need `MIN_CONTEXT_TOKENS` (12k) —
  charge sheet plus four speeches. A representative sees only the charge sheet
  plus its own 2,000-token cap (D-010), so `REPRESENTATIVE_MIN_CONTEXT_TOKENS`
  is 6,000. A lower floor widens their candidate pool and lets Mode B reach
  further down the price list before it runs out of distinct models.
- **What happens when the list cannot place every agent.** Reusing one model
  across agents collapses Mode B toward Mode A for those agents and muddies the
  comparison in spec.md §1, so it is not the code's to choose silently.
  `buildModelMap` fails, naming the agent it could not place, and the run does
  not start. Reuse, if ever wanted, is a mapping the user configures on purpose.

## D-012 — This account cannot call OpenRouter free-tier models

Both real runs so far have hit HTTP 403 on advertised-$0 models:

- **Turn 3 (Mode A):** the live cheapest pick,
  `thinkingmachines/inkling-small:free`, returned 403 on all seven calls. The
  run was redone on `openai/gpt-oss-20b` via `DEMO_MODEL_ID`.
- **Turn 4 (Mode B):** a pure cheapest-first map is almost all `:free` models
  (and, at the very top of the price list, non-chat models such as
  `google/lyria-3-pro-preview`). The real run used `--skip-free`, which drops
  $0 models from the pool.

Two 403s across two turns and two modes is a standing account-level
restriction, not a transient outage. Whoever runs this later should expect to
pass `--skip-free` (Mode B) or set `DEMO_MODEL_ID` to a cheap paid model
(Mode A) unless the account's free-tier access has since been enabled.

The selection code still prefers zero-cost models as spec.md §4 requires — the
restriction is external, and the escape hatches (`includeZeroPrice: false`,
`DEMO_MODEL_ID`) resolve against the same live list rather than hardcoding a
name.

## D-013 — The web UI runs the pipeline; closing the browser does not stop it

Turn 5 adds a local web server (`scripts/server.js`) and a page. `POST /run`
calls the same `executeRun()` the CLI uses (`scripts/run-once.js`) — one
pipeline invocation per request, no dry run, no duplicated model-selection
logic — and shapes its response straight from the protocol recorder.

The run executes server-side in the Node process. If the browser tab closes
mid-run, the HTTP response socket drops but `runTribunal` keeps going: the
remaining sequential model calls still happen and still cost money. **Closing
the browser does not stop a run and does not save cost.** The budget gate
(D-006) remains the only thing that ends a run before its last call. A clean
mid-run abort would need an `AbortSignal` threaded into `src/pipeline.js`,
which this turn was scoped not to touch — recorded as [OPEN] in spec.md §9.

Consequences held to this turn's scope:

- **One run at a time.** A second `POST /run` while one is in flight gets 409,
  before any work starts — belt-and-braces with the page disabling its button.
- **Completed runs are still persisted** (`writeRunRecord` → `runs/*.json`, no
  UI listing) so spec.md §6 holds even for a run whose browser went away. The
  page keeps nothing across reloads.
- **Local only.** The server binds `127.0.0.1`; no auth (spec.md §8 excludes
  it); nothing assumes deployment.

**Response contract.** `POST /run` returns, all straight from the
report/recorder: `mode`, `modelSource`, `representatives[]` (`agentId`,
`seat`, `status`, and — added in turn 6 — `speech`: the validated text when
`status` is `ok`, `null` otherwise), `verdicts[]` (`judge_id`, `verdict`,
`reasoning`), `judges` counts, `totals`, `wallClockMs`, `stopped`,
`stopReason`, and `runId` (turn 8: the database id of the saved run,
replacing turn 6's `runFile`; `null` when persistence is off). Turn 8 also
added the read-only `GET /runs` (list) and `GET /runs/:id` (one run, in the
same shape as `POST /run`). The shape is exercised by `test/server.test.js`.

## D-014 — Runs persist to a local SQLite database, not JSON files

spec.md §9 left persistence open between local JSON files and Supabase, to be
settled once it was clear whether run records needed querying. The course
lecture settles it: the system must keep "every charge sheet and its opinion,
so a past case can be found" and "a log of every model call", and poses "why
not just keep that audit trail in a plain file?" as a rhetorical no. Turns 3–7
wrote `runs/*.json` — git-ignored, invisible to a fresh clone, with no way to
list or find a past case. Turn 8 replaces that with SQLite.

**SQLite through `node:sqlite`.** Node's built-in binding — no dependency, which
the "no new dependency" rule requires. It is still flagged experimental on
Node 24, so `engines.node` was raised from `>=22` (which does not even
guarantee the module — it landed in 22.5) to `>=22.6.0`, and the `test` / `dev`
/ `demo` scripts pass `--disable-warning=ExperimentalWarning` so the warning is
not printed on every run.

**Four tables.** `runs` (one row per run: charge sheet, mode, model source,
start/end, total cost and tokens, stopped flag and reason); `verdicts` and
`speeches` (one row each per judge / representative that produced a valid
output — verdicts and speeches are the *accepted outputs*, structurally alike);
`calls` (one row per model call, in call order — the log the lecture names,
carrying model id, token counts, cost, duration, attempt, validation outcome,
and the failure message in `error_text`). Nullable columns hold `NULL` when the
API reported no value; nothing is estimated to fill them (§6).

**Speeches sit beside verdicts, not on `calls`.** A representative may take two
`calls` (the corrective retry) but yields one accepted speech, so a speech is
not call metadata. It cannot be columns on `runs` (a variable count). Beside
`verdicts` it gets the same first-class, per-run, per-agent treatment the
opinions get, and `calls` stays a clean call log. `seat` is stored on the row
so it is self-describing and stays truthful if personas ever change.

**One write path.** `scripts/db.js` `saveRun` is the only place rows are
inserted, in one transaction. `run-once.js` `persistRun` wraps it (open, save,
close) for the CLI; the server holds one open handle and calls the same
`saveRun`. The old `writeRunRecord` is gone — no dual-write transition.

**Reading back.** `db.getRun(id)` rebuilds the exact `POST /run` response shape
from the rows (representative status from whether a speech/call exists, judge
`failed` vs `notAttempted` likewise, `totals` re-summed from `calls` per §7.6),
so the "past runs" page renders a stored run with turn 6's code unchanged.
`db.listRuns` is the plain chronological list — no search or filtering (out of
scope).

**Init.** `initDb` runs `CREATE TABLE IF NOT EXISTS` for all four tables on
open — one schema version, the whole migration story for now. The database file
lives at `db/tribunal.db`, git-ignored like `runs/` was, created on first use so
a fresh clone needs no setup.

**The existing `runs/*.json` (turns 3–7) are left as-is** — a historical
artifact on disk, not migrated. Several are `npm test` litter with fabricated
costs, and `docs/findings.md` already records the meaningful runs; importing
would either pollute the list or require hand-picking. Decided with the user.

## D-015 — The UI is a "Case File", and the visual system is fixed

Turns 5, 6 and 8 built the web UI "functional over polished" on purpose. By
turn 9 the system was proven end to end — real runs, real persistence, a
written finding — so turn 9 was a full visual design pass, on a specific
direction rather than a generic "legal/document" template.

**Direction: a court docket, not an AI-tool dashboard.** One committed light
theme — aged paper — no dark variant. The tokens (in `public/style.css`
`:root`) are fixed and a later turn should not drift them toward the generic
defaults (warm cream + serif + terracotta; near-black + neon; hairline
broadsheet):

- `--paper` #FAF8F3, `--paper-shade` #F1EDE3, `--ink` #1C1E26,
  `--ink-soft` #5B5C64, `--rule` #C9C2B4
- `--verdict-justified` #2F5233 (forest — the "approved" stamp ink),
  `--verdict-not-justified` #7A2E2E (wine — the "denied" stamp ink)
- `--seal-gold` #9C7A3C — institutional accent for the docket numeral, one
  header rule, decorative glyphs. Never a fill, never on small body text (it
  is ~3.4:1 on paper — fine for the large numeral, not for labels).

**Type roles map to the system's own structure.** Source Serif 4 is used only
for model-authored adjudication text (verdict reasoning, speeches); IBM Plex
Sans for the tribunal's chrome (wordmark, labels, buttons, table headers); IBM
Plex Mono for recorded data (costs to full six decimals, tokens, durations,
ids), set like figures stamped into a form. Loaded from Google Fonts with real
fallback stacks.

**Signature element: the verdict stamp.** Each judge's verdict renders as a
bordered, double-ruled, slightly rotated ( -1° to -2°, varied per stamp) mark
in the verdict's colour, judge id above the verdict text, `mix-blend-mode:
multiply` over a `--paper-shade` band. The three sit in a row so agreement or
disagreement reads at a glance — this is D-004 ("three opinions stand side by
side, no aggregation") made visible. A staggered stamp-down animation is the
one place with visual boldness; it is disabled under
`prefers-reduced-motion`, which also covers the spinner and the form dim.

**Copy in the register:** "File the case" (not "Run"), "Case docket" (not
"Past runs" — the list literally is a dated register of adjudicated cases),
`№ NNN` for the run's database id. One behavioural test assertion
(`test/server.test.js`, the `/past` page text) was updated to match.

Scope was presentation only: no pipeline, harness, schema, or server-contract
change. `render.js` still feeds `showResults` the same shape from a live run
or `db.getRun`, so a stored run's detail view and a fresh run's result render
identically.

## D-016 — Prepared for Render; a public instance has unsolved risks

The lecture (module 7) names deployment: "deployment is what lets someone else
open the Tribunal at a web address and put a case." Turn 10 makes the server
deployable on Render. It does not deploy — that is a manual step in Render's
dashboard (README, "Deploying").

**What changed.** The server now binds `0.0.0.0` on `process.env.PORT`
(falling back to 3000 locally); `DB_PATH` is read from the environment,
defaulting to the local `db/tribunal.db`; `package.json` gains a `start`
script with no `--env-file` (Render injects env vars directly). `render.yaml`
describes one web service on the `starter` plan, `numInstances: 1`, a 1 GB
disk mounted at `/var/data`, and the env vars by name — `OPENROUTER_API_KEY`,
`RUN_BUDGET_USD`, `DEMO_MODEL_ID` as dashboard secrets, `DB_PATH` wired to
`/var/data/tribunal.db`.

**Why a persistent disk.** Render's filesystem is ephemeral — anything on disk
is lost on restart or redeploy unless a disk is attached. `node:sqlite` writes
a real file, so the database needs the disk or every run vanishes on the next
deploy. A disk requires a paid plan; the free plan cannot keep the database.

**Why one instance.** The SQLite file, its single disk, and the in-process
"one run at a time" lock all assume a single process. `numInstances` must stay
1; the service cannot be scaled horizontally as built.

**Open risks of going public — named here, not solved (out of scope by
instruction):**

- **Unbounded spend.** Anyone who finds the URL can trigger a real, paid model
  run. The budget gate (spec.md §6, D-006) caps a *single run*; it is not
  cumulative across callers or time. A public instance's total OpenRouter
  spend is bounded only by the account's own limits, not by this application.
- **No authentication.** spec.md §8 excludes it. Every endpoint is open,
  including `POST /run`.
- **No rate limiting.** The 409 "one run at a time" lock throttles concurrency
  to one, but nothing limits how many runs one caller can queue over time.
- **No per-user or per-day budget.** There is no notion of a caller, so no
  way to attribute or cap spend per caller.

Mitigations (an auth gate, a rate limiter, a cumulative/daily cap, or simply
not making the URL public) are deferred. The README points a deployer at this
entry before they publish the URL.

## D-017 — The run store moves to Turso/libSQL; the zero-dependency era ends

**The project now has a runtime dependency.** `@libsql/client` is the first —
about 14 installed packages including a native addon (`libsql`, a Rust/napi
binding), plus `@libsql/hrana-client`, `ws`, `js-base64`, `promise-limit`.
Stated plainly here rather than buried: turns 2–10's "zero dependencies"
milestone is over as of turn 11.

**Why the swap — a deployment constraint, not a technical failure.**
`node:sqlite` worked correctly from turn 8 on. But it writes a real file, and
Render's free plan has no persistent filesystem; a persistent disk there needs
a paid plan and a payment method the deployer does not have. Turso (hosted
libSQL, SQLite-compatible) has a genuinely free tier — 5 GB, 500M row
reads/month, no card — far beyond this project's needs. So D-014's local-SQLite
choice is superseded **for the deployed environment**. Local dev and `npm test`
still use a libSQL *file* (`db/tribunal.db` by default, `DB_PATH` to override) —
same SQLite engine, same schema — so D-014's substance holds off Render.

**Connection.** `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` set → the hosted
database; unset → the local file. `initDb` resolves this; `render.yaml` lists
the two vars as dashboard secrets and no longer carries a disk or `DB_PATH`.

**What changed in the code, and what did not.** `scripts/db.js` is rewritten on
`@libsql/client`; `initDb` / `saveRun` / `listRuns` / `getRun` and their direct
callers (`run-once.js`'s `persistRun`, `server.js`'s store accessor, `demo.js`)
became **async** — the libSQL client has no synchronous API. The four-table
schema, every column, and the return-value shapes of the four functions are
unchanged. Spike-verified against a local libSQL file before committing:

- **Transaction atomicity** — `db.transaction('write')` / `commit()` /
  `rollback()`; a failed child insert rolls the whole run back (test:
  "saveRun is atomic").
- **Foreign keys** — `PRAGMA foreign_keys = ON` on the client is honoured
  inside transactions; a bad `run_id` raises `SQLITE_CONSTRAINT`.
- **`lastInsertRowid`** — a transaction's `execute()` returns it as
  `undefined`, so `saveRun` uses `INSERT … RETURNING id` instead. Deterministic
  and connection-independent.
- **`:memory:` is dropped.** libSQL local mode opens a fresh connection for a
  transaction, which cannot see an in-memory schema. Tests use a throwaway file
  per test (`os.tmpdir()`, removed in `t.after`) — testing the
  `saveRun`/`listRuns`/`getRun` contract, not a `node:sqlite` API.

**Unverified.** Foreign-key enforcement and the full read/write flow against a
*real* Turso instance (no token available in this environment); `npm ci` with
the native `libsql` prebuild on a real Render build.

**Unchanged:** D-016's open risks of a public instance — no auth, no rate
limiting, per-run (not cumulative) budget cap.
