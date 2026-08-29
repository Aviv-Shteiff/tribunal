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
