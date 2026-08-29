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
