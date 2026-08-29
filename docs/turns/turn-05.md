# Turn 05 — A web page in front of the pipeline

Date: 2026-08-29
Branch: `turn-05-web-ui`
Commit at start: `f4132d0`

---

## 1. Intent

Give the tribunal a face: a local page where a charge sheet is typed, a mode
picked, and one real run triggered — showing the verdicts, which representatives
spoke, and what the run cost — with the server calling the exact same `src/`
functions the CLI uses and reporting numbers straight from the protocol
recorder. The pipeline does not change.

## 2. Specification

Touches nothing locked. `spec.md` §6 ("every completed run is persisted") is
honoured by the server; §8 (no auth, no streaming) and §3/§5/§6 behaviour are
inherited unchanged from the pipeline. `spec.md` §9 gains one [OPEN] line
(mid-run abort). `decisions.md` gains D-013.

Done means: a `node:http` server serves one page and one endpoint; `POST /run`
runs the pipeline once through shared code (not duplicated, not run twice);
the response carries 4 representative statuses, the verdicts that validated,
and the recorder's cost/token/duration totals; the page renders all of that
with a working waiting state and a visible error/stopped state; one fake-client
test asserts the response shape; and one real Mode A run has gone through the
endpoint end to end.

**Points the spec was silent on, and how they were decided** (all put to the
user before code, answered by the user):

- **Browser closed mid-run.** The run continues server-side and the paid calls
  still happen — closing the tab does not stop the run or save cost. No
  pipeline change to add an abort this turn. Documented in D-013 and §9.
- **Persistence vs "no history".** "No history" means the *page* keeps nothing
  across reloads. The server still writes `runs/*.json` per completed run (no
  UI listing) so §6 holds, including for a run whose browser went away.
- **Mode B on this account.** D-012: the free tier 403s. The UI's Mode B run
  passes `skipFree: true` server-side (as turn 4's on-record run did); the page
  toggle stays a plain "A / B".

**Decided during execution, smaller, flagged here rather than asked:**

- The model-resolution glue that lived inside `scripts/demo.js`
  (`resolveModeA`/`resolveModeB`/`readChargeSheet`/`writeRunRecord`) is
  extracted to `scripts/run-once.js`, which both `demo.js` and `server.js`
  import. This is how "call the same functions, don't duplicate logic" is met.
  `scripts/demo.js` is not a tested module and is not in `src/`; `npm run demo`
  behaviour is unchanged.
- `run-once.js` errors by return (`{ ok: false, reason }`), never
  `process.exit` — a server has to survive a run that could not start.
- The response includes a `judges` count block, so the page can say "2 of 3
  judges returned a verdict — 1 failed (elon)" instead of a verdict silently
  missing. The counts are the recorder's own, mirroring `demo.js`'s existing
  line; no new failure copy.
- Representative status is `ok` / `failed` / `not attempted` (three values) —
  `not attempted` is the recorder's own category for a budget stop mid-stage,
  not invented copy.
- `createServer(deps)` takes `persist: false` for tests so `npm test` does not
  write to `runs/`; one test leaves it at the default and asserts the record
  is written (§6).

## 3. Context supplied

Given: `CLAUDE.md`, the current `spec.md` and `decisions.md`, and an
instruction to read `src/pipeline.js` and `scripts/demo.js` in full rather than
assume their interface. Both were read.

Stated conventions: lightest option with no new dependency (or name one small
package and justify it first); build only the server and the page — no run
history, comparison views, or A-vs-B analysis; do not touch `src/pipeline.js`,
`src/model-select.js`, or any tested module; plain HTML/CSS, no framework, no
auth, local only, nothing that assumes deployment; plan and the dependency
question first, wait for approval; raise anything about serving a page and
running a paid call from one process that the spec does not cover.

## 4. Plan

Approved after the three questions were answered (accept browser-close
semantics with no pipeline change; server still writes `runs/*.json`;
`skipFree: true` for UI Mode B).

1. Branch `turn-05-web-ui` off `main`.
2. `scripts/run-once.js` — extract config → live list → model resolution →
   pipeline → run record. Errors by return. `deps` hook for tests.
3. `scripts/demo.js` — import from `run-once.js`; keep CLI parsing,
   `printReport`, `main`, add an entry-point guard. No behaviour change.
4. `scripts/server.js` — `node:http` on `127.0.0.1`. `GET /` serves the page
   with the charge sheet injected; `POST /run` validates two inputs (non-empty
   string, mode a|b), runs `executeRun` once, persists, responds. `running`
   flag → 409. `createServer(deps)` factory for the test.
5. `public/index.html` — textarea (pre-filled, editable), A/B radio, Run button
   that disables + shows a waiting line, results area (verdicts, rep table,
   summary), error/stopped area that prints recorded reasons verbatim. Inline
   plain CSS, inline vanilla JS.
6. `test/server.test.js` — fake client via the existing `fake-client.js`:
   response shape, a failed judge, input validation, 409, and §6 persistence.
7. `package.json` — add `"dev": "node --env-file=.env scripts/server.js"`.
8. `npm test` green.
9. One real Mode A run through the endpoint.
10. `decisions.md` D-013, `spec.md` §9 line, this document. Commit per logical
    change. Do not merge — wait.

## 5. Execution

Followed the plan. **No dependency added** — `node:http` and global `fetch`
(Node 22+) cover it; `node_modules` is still absent. `src/` untouched;
`scripts/demo.js` refactored but `npm run demo` unchanged; no existing test
file changed.

`npm test`: 87 → 93 (6 new server tests, counting the persistence one added
after the first real run showed a verdict can go missing).

**The real run** — `POST /run` over the endpoint, Mode A, against the fixture's
charge sheet, with `DEMO_MODEL_ID=openai/gpt-oss-20b` in the server's
environment (D-012: the free tier 403s, so Mode A needs the override, exactly
as turn 3). Server started with `npm run dev`.

`GET /` → HTTP 200, the page with `<textarea id="case">` holding the Case T-001
charge sheet, no `{{CHARGE_SHEET}}` placeholder left.

`POST /run` → HTTP 200. The JSON the page rendered
(`runs/run-2026-08-29T11-34-06-993Z.json` on disk):

- **Representatives:** jon_snow ok, tyrion_lannister ok, daenerys_targaryen ok,
  grey_worm ok — 4 of 4. (daenerys failed validation on attempt 1, passed on
  the one corrective retry; the response shows the final status.)
- **Verdicts:** barak **not justified**, elon **not justified**, shamgar **not
  justified** — 3 of 3, each with full reasoning.
- **`judges`:** completed [barak, elon, shamgar], failed [], notAttempted [].
- **Totals (recorder):** 7 calls, 10,695 prompt + 6,113 completion = 16,808
  tokens, **$0.00113494**, 0 calls with unknown cost, recorded call duration
  119,931 ms.
- `wallClockMs` 119,932. `stopped` false. `stopReason` null.
  `modelSource` `DEMO_MODEL_ID`. `runFile`
  `run-2026-08-29T11-34-06-993Z.json`.

An earlier attempt on the same code path returned 2 verdicts because the elon
judge call hit the 60 s request timeout (`ModelCallError`, not retried — the
retry rule is for validation failures only). That is a faithful partial result:
the page would have shown "2 of 3 judges returned a verdict — 1 failed (elon)"
plus the two verdicts. The run above is the clean one, on record.

Total real spend this turn: **$0.00113494** for the on-record run (a handful of
earlier throwaway runs during development cost a similar amount each).

## 6. Verification

`npm test` — 93 tests, 93 pass, 0 fail.

| Check | Method | Result |
|---|---|---|
| `POST /run` returns the shape the page reads (4 rep statuses, verdict fields, recorder totals) | `server.test.js`, fake client | pass |
| A failed judge → fewer verdicts, `judges.failed` names it | `server.test.js`, fake client | pass |
| Both inputs validated before anything runs (empty case, bad mode → 400, no fetch) | `server.test.js` | pass |
| A second concurrent `POST /run` → 409 before work starts | `server.test.js` | pass |
| A completed run is written to `runs/` (spec.md §6) | `server.test.js` | pass |
| `GET /` serves the page with the charge sheet pre-filled, placeholder gone | `server.test.js` + the real run | pass |
| One real Mode A run renders end to end over the endpoint | `npm run dev` + `POST /run` | pass — 4 speeches, 3 verdicts, $0.00113 |
| Totals are the recorder's, not recomputed in the server | code review of `shapeResult` + test asserts the sum | pass |
| `src/` and existing tests untouched | `git diff --stat`; `npm test` unchanged count for `src/` suites | pass |
| `npm run demo` still works (refactor was behaviour-preserving) | `node --check`; demo path is `executeRun` with an `onResolved` hook that prints the Mode B map before calls | not re-run live this turn (no `src/` change; covered by turns 3–4 and syntax check) |

**Not verified, and why:**

- **A real Mode B run through the UI.** Scoped to one Mode A run this turn.
  Mode B over the endpoint uses `skipFree: true`; turn 4 proved that path live.
- **Browser actually closed mid-run.** The behaviour (run continues, cost
  incurred) is argued from how `node:http` and the un-abortable pipeline work,
  and recorded in D-013; not staged as a live test.
- **The page in a real browser.** Rendering was verified by driving the same
  HTTP endpoint the page's `fetch` calls and by serving `GET /`; no headless
  browser was used.
- **Budget-gate stop shown in the UI.** The page has the branch
  (`d.stopped` → the recorded `stopReason`), exercised only via the shape,
  not a live cap-below-cost run.

## 7. Audit trail

Commits in this turn:
- `84295c1` — extract run orchestration to `scripts/run-once.js`
- `d2693e1` — `scripts/server.js` + `public/index.html` + `dev` script
- `338754a` — `test/server.test.js`
- (this commit) — docs: D-013, `spec.md` §9, this record

Model calls: one on-record run of 7 calls, plus a few throwaway runs during
development. Cost incurred: ~$0.001 per run; on-record run **$0.00113494**.

**Locked this turn:** nothing new in `spec.md`.

**Left open:**
- **Mid-run abort from the UI** — `spec.md` §9, needs an `AbortSignal` in
  `runTribunal`.
- **The modality filter** (from turn 4) — still open; Mode B in the UI leans on
  `--skip-free` to avoid it.
- **`npm run lint`** — still documented in `CLAUDE.md`, still not implemented.
- **Run listing** — `runs/*.json` accumulates; nothing lists or reads it back,
  by design this turn.

**Rules written into `CLAUDE.md` this turn:** none. No correction was issued.

**Milestone:** the tribunal can now be run from a browser — type a charge
sheet, pick a model configuration, get three verdicts and a costed protocol —
with the page a thin layer over the same pipeline the CLI drives.
