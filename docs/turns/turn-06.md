# Turn 06 — Making the page readable

Date: 2026-08-29
Branch: `turn-06-readable-ui`
Commit at start: `404b648`

---

## 1. Intent

Turn 5 proved the UI works end to end but it is raw. This turn makes the same
results page readable and appropriately layered for a first-time viewer —
render the model's markdown, show a real spinner with the form dimmed while a
run is in flight, and put the headline (judge + verdict; mode, count, cost,
completed/stopped) in front while full reasoning and developer detail sit
behind collapsed toggles — without changing what the page fetches or how runs
execute, beyond one approved contract addition.

## 2. Specification

Nothing locked. `spec.md` §8 (no streaming, no auth) and the pipeline
behaviour are inherited unchanged. The one change to the HTTP contract is
recorded in `decisions.md` D-013.

**Contract change, raised and approved before the work.** `POST /run`'s
response gains `representatives[].speech`: the validated speech text when a
representative's `status` is `ok`, `null` otherwise. Turn 5's contract carried
representative *status* but not the speech itself, so the page could show that
a representative succeeded but never what it argued. Item 1 of this turn's
brief ("markdown rendering for speech and verdict reasoning text") could not be
met for speeches without it. The user approved adding the field.

**The markdown question, answered from turn 5's real runs.** The two turn-5
run records (`run-2026-08-29T11-30-39-288Z.json`,
`run-2026-08-29T11-34-06-993Z.json`) plus the turn-4 Mode B record were
feature-scanned. What the model actually produces in reasoning/speech text:

- `**bold**` — yes (elon's numbered-point headers).
- `*italic*` (single asterisk) — yes, heavily (barak: `*debatable*`, `*Justice*`,
  `*necessity defense*`, …). **Not named in the brief's list**; without it these
  render as literal asterisks — the exact bug this turn removes. Added.
- Literal `\n` — yes. barak's verdict in `…11-34…` contains the two-character
  sequence `\n` as *text* between numbered points, not real newlines. A plain
  blank-line split misses it. The renderer normalises `\r\n` and literal `\n`
  to real newlines first. Added.
- ATX headers (`##`) — **in the brief's list, zero occurrences** in any of the
  three records. Supported anyway (one cheap regex), flagged as speculative.
- Numbered points — yes, but always separated by blank lines, so they render as
  paragraphs that keep the model's own "1." / "2." prefix (readable, faithful).
  A genuine tight list (every line numbered) still becomes `<ol>`.
- Not seen, not handled: bullet lists, `` `code` ``, blockquotes, links,
  tables. Handling them risks mangling ordinary prose.

## 3. Context supplied

Given: `CLAUDE.md`, current `spec.md` and `decisions.md`, and an instruction to
read `public/index.html` and `scripts/server.js` in full before touching
presentation. Both read. The two turn-5 run records were read to answer the
markdown-sufficiency question.

Stated conventions: change presentation only; do not touch `src/`,
`scripts/run-once.js`, `scripts/demo.js`, or the server request/response
contract — stop and ask if the JSON shape must change (it did; asked;
approved); no CSS framework, build step, or dependency; no new features beyond
items 1–5 (no run history, re-run button, or copy-to-clipboard); restate the
intent and list file-by-file changes and the markdown finding, then wait.

## 4. Plan

Approved, with two additions the user made when approving: fix `*italic*` and
literal-`\n`; add `representatives[].speech` to the response.

1. Branch `turn-06-readable-ui` off `main`.
2. `scripts/server.js` — `shapeResult`: add `speech` per representative from
   `report.speeches` (`null` when the representative produced none). Nothing
   else in the server changes.
3. `public/index.html` — the presentation work:
   - CSS spinner (`@keyframes`, no asset, no library) + a `.dimmed` state on a
     new `#form` wrapper.
   - `renderMarkdown()` — escape, normalise newlines, split on blank lines,
     per block: ATX header / tight numbered list / paragraph; inline
     `**bold**` then `*italic*`.
   - Verdict cards: `judge_id` + verdict pill shown; reasoning behind a
     per-card `<details>` "Show full reasoning", closed by default.
   - Speeches: one `<details>` card per representative that produced one.
   - Representative table kept; column relabelled Status; readable styling.
   - Run summary split — tier 1 always visible (mode, verdicts returned, total
     cost, completed/stopped + reason); tier 2 behind `<details>` "Technical
     details" (modelSource, token counts, both durations, saved run file).
   - Keep the `inFlight` guard, `btn.disabled`, and the fetch/error flow
     untouched. Keep `{{CHARGE_SHEET}}` inside `<textarea id="case">`.
4. `test/server.test.js` — assert `speech` in the response (string when `ok`);
   add a failed-representative test (`status` `failed`, `speech` `null`).
5. `npm test` green; render real turn-5 text through `renderMarkdown` and
   eyeball; one live Mode A run over the endpoint.
6. `decisions.md` D-013 contract note; this document. Commit per logical
   change; do not merge — wait.

## 5. Execution

Followed the plan. Files touched: `scripts/server.js` (one field),
`public/index.html` (rewritten presentation), `test/server.test.js` (two
additions), `docs/`. `src/`, `run-once.js`, `demo.js` untouched. No
dependency, no build step.

`npm test`: 93 → 94 (the new failed-representative test; the shape test gained
`speech` assertions).

**Renderer checked against real output.** `renderMarkdown` was copied into a
scratch script and run over every verdict and speech in both turn-5 records:

- `*debatable*`, `*Justice*`, `*ti'ar*`, … → `<em>`; `**Imminence of threat**`,
  `**Proportionality**` → `<strong>`; no bare `**` or bare `*` left anywhere.
- barak's `…11-34…` verdict — literal `\n\n` between nine numbered points →
  nine `<p>` blocks, each keeping its "1."–"9." prefix. No `\n` left in output.
- `…11-30…` verdicts — plain prose with double-space sentence breaks and no
  paragraph markers → one `<p>` each, faithful to what the model emitted.
- `&`, `<`, `>` escaped before any markup is inserted.

**Live run** — `npm run demo`… no: `npm run dev` with
`DEMO_MODEL_ID=openai/gpt-oss-20b` (D-012), then `POST /run` Mode A against the
fixture charge sheet. `runs/run-2026-08-29T12-55-59-169Z.json`:

- `ok: true`, mode A, `stopped: false`.
- **Representatives:** all four `status: "ok"`, each with `speech` text (969 to
  3,480 chars) — the new field populated from a real `report.speeches`.
- **Verdicts:** barak, elon, shamgar — all **not justified**, reasoning 1,214
  to 3,849 chars. barak and elon both contain `**bold**` and `*italic*`; elon
  has blank-line paragraphs.
- **Totals (recorder):** 7 calls, 13,043 prompt + 7,169 completion = 20,212
  tokens, **$0.00167026**, 0 unknown-cost calls, recorded duration 72,271 ms;
  `wallClockMs` 72,275.
- This run's elon verdict rendered through the copy: `**…**` → `<strong>`,
  `*…*` → `<em>`, seven `<p>`, escaping intact.

`GET /` served the rebuilt page with `#form`, `#spinner`, `class="spinner"`,
`#speeches`, `#summary-basic`, `#tech`, `renderMarkdown`, and no leftover
`{{CHARGE_SHEET}}`.

Total real spend this turn: **$0.00167026**, one run.

## 6. Verification

`npm test` — 94 tests, 94 pass, 0 fail.

| Check | Method | Result |
|---|---|---|
| Response carries `representatives[].speech` (string when `ok`) | `server.test.js` shape test | pass |
| A representative that fails twice → `status` `failed`, `speech` `null` | `server.test.js` new test | pass |
| Failed-judge case still shapes correctly (fewer verdicts, named) | `server.test.js` | pass |
| 409 on a concurrent run; input validation before any run; §6 persistence | `server.test.js` (turn 5, unchanged) | pass |
| `GET /` serves the page, charge sheet pre-filled, placeholder gone | `server.test.js` + live | pass |
| `renderMarkdown` on real turn-5 text: bold, italic, literal-`\n`, blank-line paragraphs, HTML-escaped | scratch script over both run records | pass — no literal markers left, no unescaped `<`/`>` |
| One live Mode A run renders end to end with the new field | `npm run dev` + `POST /run` | pass — 4 speeches, 3 verdicts, $0.00167 |
| `inFlight` guard / `btn.disabled` / fetch flow unchanged | diff review — only the spinner/dim lines were added around them | pass |
| `src/`, `run-once.js`, `demo.js` untouched | `git diff --stat` | pass |

**Not verified, and why:**

- **The page in a real browser.** No headless browser here. Rendering was
  checked by running `renderMarkdown` over real model text and by serving
  `GET /`; the DOM assembly in `showResults` is plain `document.createElement`
  and `<details>`.
- **ATX header rendering** — the `#{1,6}` branch has never had real input; no
  run has produced a `##` line.
- **A tight numbered list → `<ol>`** — no run has produced numbered lines
  without blank lines between them; only the paragraph fallback has run on real
  data.
- **Budget-gate stop shown in the tier-1 summary** — the branch exists
  (`d.stopped` → recorded `stopReason`), exercised only via the response shape,
  not a live cap-below-cost run.

## 7. Audit trail

Commits in this turn:
- `a972823` — `representatives[].speech` in the response
- `100595a` — readable page: markdown, spinner, collapsible verdicts/speeches, two-tier summary
- `22ad44c` — tests for the `speech` field and a failed representative
- `bf02a48` — docs: D-013 contract note, this record
- `2791853` — fix: spinner showed on fresh page load
- `1a61003` — strip markdown syntax from `fixtures/case-t001.md`

**Failure found after first review, fixed:** on a fresh page load the spinner
and its "Running" text were visible before Run was clicked. Cause: the id rule
`#spinner { display: flex }` out-specifies the UA `[hidden] { display: none }`,
so the `hidden` attribute had no effect on that element. Fix: a global
`[hidden] { display: none !important }` so the attribute stays authoritative.
One line; `npm test` still 94/94.

**Also on review, before merge:** `fixtures/case-t001.md` still had `**` and
`##` in it, which showed as literal characters in the textarea (the charge
sheet is plain text by nature). Stripped the bold markers, ATX header
prefixes, and inline-code backticks; kept the wording, the dash bullets, the
section labels, and the `---` rule `readChargeSheet` splits on. Fixture only.

Model calls: one live Mode A run of 7 calls. Cost incurred: **$0.00167026**.

**Locked this turn:** nothing new in `spec.md`.

**Left open:**
- ATX headers and tight numbered lists in `renderMarkdown` are unproven on real
  output (no run has produced them).
- Mid-run abort from the UI — still `spec.md` §9, unchanged.
- The modality filter (turn 4) — still open.
- `npm run lint` — still documented in `CLAUDE.md`, still not implemented.

**Rules written into `CLAUDE.md` this turn:** none. No correction was issued.

**Milestone:** the results page is legible to someone opening it for the first
time — verdicts and their reasoning render as formatted text, a spinner shows
the run is working, and the summary separates "what happened" from "the record
a developer checks".
