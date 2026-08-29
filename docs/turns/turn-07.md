# Turn 07 — Findings from the manual runs

Date: 2026-08-29
Branch: `turn-07-findings`
Commit at start: `8a5a3e6`

---

## 1. Intent

Record the outcomes of the seven tribunal runs done by hand through the browser
UI on 2026-08-29 (four Mode A, three Mode B, default charge sheet), so the
Mode A vs Mode B comparison that `spec.md` §1 describes has a written result
for this case.

## 2. What was done

- Wrote `docs/findings.md`: a one-paragraph summary tied to `spec.md` §1, one
  results table (run, mode, each judge's verdict or FAILED, representative
  failures), a "what this suggests" section held to two stated observations
  plus the note that four vs three runs is too small to be statistically
  confident, and a run-file matching section.
- No code, tests, or dependencies. Nothing under `src/`, `scripts/`, or
  `public/` was touched. `npm test` is unaffected (94 pass).

The results were supplied by the user; this turn did not re-run the tribunal.
Numbers were checked only for internal consistency. The three Mode B results
were matched one-to-one and uniquely to their `runs/*.json` files. The four
Mode A results could not be matched to specific files — they share an identical
recorded outcome, and some Mode A runs that day were turn 5 / turn 6
verification runs rather than browser runs — so `findings.md` says so instead
of guessing.

## 3. Audit trail

Commits in this turn:
- (this commit) — `docs/findings.md` and this record

`docs/decisions.md` was **not** touched. It is a decision log (D-001…D-013)
with no changelog or index of standalone documents, and `CLAUDE.md`'s
discoverability convention is the `docs/turns/` trail, not a reference list in
`decisions.md`. `findings.md` is discoverable through this turn record.

A new `turn-07.md` was chosen over a line in `turn-06.md`'s "Left open":
turns 1–6 give every directed cycle its own `turn-NN.md`; turn 2's addendum
pattern is for follow-on work within the same turn before merge, not a new
cycle; and "Left open" bullets point to work deferred to *future* turns, which
this is not — turn 6 was already merged and pushed. This turn is short because
it is documentation only, which `CLAUDE.md` permits ("doesn't need the full
turn-NN.md ceremony").

Model calls: none. Cost: $0.00.

**Locked this turn:** nothing.

**Left open:** nothing new.

**Milestone:** the first written result of the Mode A vs Mode B comparison,
for Case T-001.
