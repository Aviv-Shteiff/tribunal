# Turn 09 — The "Case File" visual pass

Date: 2026-08-31
Branch: `turn-09-case-file`
Commit at start: `7558e80`

---

## 1. Intent

Every prior UI turn (5, 6, 8) was deliberately "functional over polished". The
system is now proven end to end — real runs, real persistence, a written
finding — so this turn is a real visual design pass on a specific direction: a
court docket / case file, not a generic AI-tool dashboard and not a generic
"legal-themed" template.

## 2. Specification

Nothing locked. Presentation only — no pipeline, harness, database schema, or
server request/response contract changes. `decisions.md` gains D-015 fixing
the visual system so a later turn does not drift it.

**Given, and followed exactly:** the "Case File" direction, a full token
system (`--paper` #FAF8F3 … `--seal-gold` #9C7A3C), three typeface roles
(Source Serif 4 / IBM Plex Sans / IBM Plex Mono), the docket-number framing,
form-checkbox mode selection, "file the case" register for the button, and the
signature verdict-stamp treatment.

**One behavioural test assertion changed:** `test/server.test.js` checked the
`/past` page contained "Past runs"; that page is now "Case docket", so the
assertion is `/Case docket/`. Nothing else in that file was touched.

## 3. Context supplied

Given: `CLAUDE.md`, `spec.md`, `decisions.md`, and the four front-end files
(`public/style.css`, `index.html`, `runs.html`, `render.js`) to read in full.
The design direction, token values, and quality floor were spelled out in the
brief.

Stated constraints: no CSS framework, build step, or dependency; keep every
existing behaviour byte-identical (disabled/waiting state, collapsibles, the
two-tier summary, the docket list and detail view); copy changes for
buttons/labels expected; don't touch `src/`, `db.js`, `run-once.js` logic,
`server.js` routes/contract, or any behavioural test assertion beyond the one
noted; plan and self-critique first, wait for approval, then screenshot and
iterate.

## 4. Plan

Approved as written, including "Case docket" over "Past runs" and the single
test-assertion update. The plan: confirm the tokens (+ two derived neutrals
`--paper-shade`, `--ink-soft`), lay out index / docket-list / run-detail, and
the exact stamp treatment; self-critique against "is any of this a generic
legal-theme answer"; then build, screenshot, iterate.

Self-critique before building cut: parchment texture, wax-seal / gavel
iconography, Latin tags, broadsheet hairline columns, warm cream, and the
Playfair/Lora + Inter pairing. What was kept as specific to *this* system: the
three stamps as a row (D-004 made visible), the serif/Plex split mapping to
model-authored vs. system text, the tier-2 summary as a filled-in court fee
form, and "docket" because the list literally is one. The Game-of-Thrones
angle stays in the content, not the chrome — a court file that takes a
fictional case as seriously as a real one is the premise; sigils would fight
it.

## 5. Execution

`public/style.css` was rewritten from scratch on the token system (rather than
patched) to avoid carrying turn 6's type-selector-vs-class spacing collisions
forward. `index.html`, `runs.html`, and `render.js` changed only as needed for
the new classes and copy:

- `index.html` — `THE TRIBUNAL` wordmark under a gold rule; charge sheet as a
  serif field with an ink top-rule; `MODEL CONFIGURATION` fieldset with two
  square tick-boxes; button "File the case"; a `#docket` element that fills in
  after a run.
- `runs.html` — heading and nav "Case docket" / "File a case"; the list table
  wrapped in `overflow-x: auto` with per-column classes; the dead
  `#detail-heading` removed (the docket header covers it).
- `render.js` — the verdict section now builds a `.stamp-row` of three stamps
  then per-judge `<details class="opinion">`; `#docket` populated as
  `№ NNN · MODE A`; `verdictStamp()` sets a per-instance `--rot` in
  [-2deg, -1deg]. Speeches, the register, the two-tier summary, and every
  collapsible behave as before. `function showResults` kept as a declaration
  (the served-asset test greps for it).

**No screenshot was taken by me** — the browser extension was declined this
session. A code-level self-audit was done instead and one iteration applied
before handing off:

- removed `h2` bottom margin that doubled with `.stack` gap; removed
  `#detail` top margin that doubled with `.flow` gap; deleted dead
  `.eyebrow` / `#detail-heading` rules;
- moved a small-text link hover off `--seal-gold` (~3.4:1 on paper) to
  `--verdict-justified` (~8.5:1); gold now only on the large docket numeral
  and decorative rules/glyphs;
- resized the stamp verdict text to `clamp(0.9rem, 2.4vw, 1.12rem)` +
  `white-space: nowrap` so three "NOT JUSTIFIED" stamps fit one row on the
  44rem page instead of wrapping;
- dropped a ruled-line textarea background (would drift from baselines over a
  long charge sheet, unverifiable without eyes) for a plain serif field;
- made `scrollIntoView` respect `prefers-reduced-motion`.

The user then reviewed it in a browser on desktop and at 375px (iPhone SE):
stamps stack correctly narrow, the docket table scrolls horizontally as
designed, layout holds. Approved.

## 6. Verification

`npm test` — 104 tests, 104 pass, 0 fail (the one changed assertion included).

| Check | Method | Result |
|---|---|---|
| Every behaviour preserved (dim/wait, collapsibles, two-tier summary, docket list + detail, deep link) | code review against turns 5/6/8; `server.test.js` unchanged except the one assertion | pass |
| `POST /run` and `GET /runs/:id` still render through one `showResults` | `render.js` feeds both the same shape | pass |
| Focus visible on every interactive element | `:focus-visible` outline on textarea, the `appearance:none` radios, button, every `<summary>`, every link | pass (code) |
| `prefers-reduced-motion` respected | stamp animation off (static rotate kept), spinner slowed, form transition off, smooth-scroll → auto | pass (code) |
| No specificity fights on section spacing | rewrite uses `gap` on flow parents; bare-element rules limited to `body` + a light reset | pass (code) |
| Responsive to mobile | `@media (max-width: 34rem)`; body `overflow-x: clip`; docket table in `overflow-x: auto` | pass — user-verified at 375px |
| Served assets intact | `/style.css` `text/css`, `/render.js` has `function showResults`, `/` has the injected charge sheet and no placeholder | pass |
| No `src/` / schema / route / contract change | `git diff --stat` — only `public/*` and one test assertion | pass |

**Not verified by me:** the rendered pixels — font loading and fallback, the
stamp `mix-blend-mode` and stamp-down animation, the docket numeral's weight.
The user confirmed these in a browser on desktop and at 375px.

## 7. Audit trail

Commits in this turn:
- `<sha>` — the "Case File" visual pass (`public/style.css` rewrite,
  `index.html` / `runs.html` / `render.js` markup + copy, one `server.test.js`
  assertion)
- (this commit) — docs: D-015, this record

Model calls: none. Cost incurred: $0.00. (The two runs in the local database,
#1 and #2, are turn-8 verification and user testing.)

**Locked this turn:** the visual system, in D-015.

**Left open:**
- The live `POST /run` response has no `startedAt`, so a fresh run's docket
  header shows `№ NNN · MODE A` while a past run's (from `db.getRun`) also
  shows the date — a minor inconsistency, not worth a contract change here.
- The `calls` log (turn 8) is still not surfaced in the UI.
- Modality filter (turn 4), mid-run abort (turn 5), `npm run lint` — still
  open.

**Rules written into `CLAUDE.md` this turn:** none.

**Milestone:** the tribunal has a visual identity — a court docket where three
judges' verdicts land as stamps, model-authored text is set in a reading
serif, and every recorded cost and token count is stamped into the form in
mono.
