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