# Turn 03 — The pipeline, and the first real run

Date: 2026-08-28
Branch: `turn-03-pipeline`
Commit at start: `d735f46`

---

## 1. Intent

Put the seven fixed personas onto the turn-2 harness, wire them into a pipeline
that produces four speeches then three verdicts, and run it once against a live
model — the first time this project spends money — to confirm the harness,
the validator, the recorder and the budget gate behave against real API output.

## 2. Specification

Touches `spec.md` §3 (pipeline), §4 (model configuration), §5 (output contract)
and §7 (acceptance criteria). Locks nothing new in `spec.md` by itself; §5 of
this document proposes the two §9 resolutions this turn was designated to make,
for the user to accept before they are written into `spec.md`.

Done means: `npm test` green; a run against `fixtures/case-t001.md` produces 4
speeches and 3 verdicts; every verdict is one of the two allowed strings; the
protocol has one record per call and the totals are the sum of the records —
all verified by running them.

**Points the spec was silent on, and how they were decided.**

- **What a representative that fails twice does to the judges' input.** §5 grants
  one corrective retry; §3 says judges receive "all four speeches". Decided with
  the user before `pipeline.js` was written: a representative whose output fails
  validation twice is simply absent from what the judges see, and the judge
  prompt states the actual surviving count rather than presenting four speeches
  when there were fewer. A judge is never handed a fabricated or empty speech.
- **How the single model for Mode A is chosen.** §4 says "one model chosen by
  the user" and forbids a remembered model name. Turn-2 left only an auto-pick
  (`selectCheapestModel`, price then context, over the live list). The first
  real run showed the auto-pick is not always usable (see §5 below), so the
  demo gained a `DEMO_MODEL_ID` environment override: when set, that id is the
  user's choice; it is still resolved against the live list, so the price and
  context recorded are OpenRouter's own numbers and not a value typed on the
  command line. The auto-pick remains the fallback when the variable is unset.
  This was put to the user during the run and answered by the user.

**Decided during execution, smaller, flagged here rather than asked:**

- **Bookkeeping labels, not self-reported ones.** A speech is tagged with the
  persona that was actually called and that persona's fixed seat, not with the
  `agent_id`/`seat` the model returned. The validator confirms those returned
  fields are one of the allowed values; it does not and should not confirm they
  match who was asked.
- **`modelSource` in the run record.** The run record now carries whether the
  model came from `DEMO_MODEL_ID` or the live auto-pick, so a reader of
  `runs/*.json` can tell how the model was chosen without inference.

## 3. Context supplied

Given: `CLAUDE.md`, `docs/spec.md`, `docs/decisions.md`, and — because this turn
is the one that touches prompts and case text — `docs/agent-profiles.md` and
`fixtures/case-t001.md`.

Stated conventions: no new dependency; branch `turn-03-pipeline`; plan first,
wait for approval, no code in the planning message; the real run is a manual,
billed step invoked by the user, never part of `npm test`.

## 4. Plan

Approved as proposed.

1. Branch off `main`.
2. `src/personas.js` — the seven personas as data, transcribed from
   `agent-profiles.md`, no prompt text invented.
3. `src/prompts.js` + tests — assemble the representative and judge prompts
   from `spec.md` §5, structure enforced in code.
4. `src/model-select.js` + tests, and the `fetchModelList` path in
   `model-client.js` — select from the live list, price first then context,
   never by name.
5. `src/pipeline.js` + tests — 4 representatives then 3 judges, sequential,
   isolated, over the turn-2 harness.
6. `scripts/demo.js` + `npm run demo` — the manual real-run CLI, reads the
   charge sheet at the edge, writes a full run record to `runs/`.
7. Run `npm run demo` for real. Report token counts and cost.
8. Resolve the two §9 open decisions the turn was designated to settle.
9. Write this document, commit, stop. No merge without the user's word.

## 5. Execution

Steps 2–6 followed the plan; `npm test` went from 49 to 77 tests, all passing.
Zero dependencies added. `npm run lint` is still not implemented — a linter is a
dependency and this turn did not need one.

**Step 7 — the real run — took three attempts:**

| Run file (`runs/`) | Model | Source | Result | Cost |
|---|---|---|---|---|
| `…T18-19-15-956Z` | `thinkingmachines/inkling-small:free` | auto-pick (pre-override) | 7× HTTP 403 Forbidden | $0.00 |
| `…T19-19-32-260Z` | `thinkingmachines/inkling-small:free` | auto-pick | 7× HTTP 403 Forbidden | $0.00 |
| `…T19-46-34-876Z` | `openai/gpt-oss-20b` | `DEMO_MODEL_ID` | 4 speeches, 3 verdicts | $0.001127 |

The live price-first auto-pick lands on `thinkingmachines/inkling-small:free`
(371 candidates qualified; 1,048,576-token context; $0/token). That key cannot
reach it — every call returns HTTP 403, recorded as a handled failure, no
tokens, no spend. This is a real gap: "prefer zero-cost models" (§4) and "the
run aborts, it does not warn and continue" (§6) are both honoured, but the
zero-cost model the filter prefers is not always callable. The `DEMO_MODEL_ID`
override was added at this point and put to the user, who chose
`openai/gpt-oss-20b`.

**The third run, in full:**

- 7 calls, every one succeeding on attempt 1 — no corrective retry was needed.
- 4 of 4 speeches, 3 of 3 verdicts. All three verdict fields were
  `not justified` — a valid enum value. Three opinions, not aggregated.
- Representative completion tokens: 435, 471, 1581, 516. Longest speech ≈ 2,111
  characters (Daenerys). Judge prompts: ≈ 2,200 tokens each (charge sheet
  1,063 + four speeches + persona and contract).
- Totals: 10,896 prompt + 5,808 completion = 16,704 tokens; **$0.001127**;
  `callsWithUnknownCost` = 0 (unlike the free model, `gpt-oss-20b` reports
  `usage.cost`). 65.1 s wall-clock, sequential.
- Every total equals the sum of its per-call records, checked by re-summing the
  protocol array in the run file.

**Total real spend this turn: $0.001127.** The first two runs cost nothing.

## 6. Verification

`npm test` — 77 tests, 77 pass, 0 fail.

| Acceptance criterion (`spec.md` §7) | Method | Result |
|---|---|---|
| §7.1 `npm test` green | ran it | pass — 77/77 |
| §7.2 a run produces 4 speeches and 3 verdicts | `npm run demo` (`…T19-46-34-876Z`) | pass |
| §7.3 every verdict value is one of the two allowed strings | inspected the run record | pass — three × `not justified` |
| §7.4 malformed / third verdict / empty are handled failures | `validate.test.js`, `retry.test.js` (turn 2), still green | pass |
| §7.5 cap below one call's cost aborts cleanly and reports | `budget.test.js`, `run-harness.test.js` (turn 2), still green | pass |
| §7.6 one record per call, totals = sum of records | re-summed the protocol array in the run file | pass — 7 records, all totals reconcile |
| §7.7 no secret in `git log -p` | grepped `git log -p` for key patterns | pass |
| Judges never see each other's output | `pipeline.js` builds each judge prompt from the speeches only; `pipeline.test.js` | pass |
| Representatives never see each other's speeches | rep prompt takes the charge sheet only; `prompts.test.js` | pass |
| No verdict aggregation | pipeline returns three separate `verdicts`; nothing combines them | pass |
| No model name hardcoded in `src/` | grep `src/` for provider and model-name substrings | pass — ids arrive as arguments or from the live list; `DEMO_MODEL_ID` is read in `scripts/`, not `src/` |
| Nothing in `src/` imports `fixtures/` (D-001) | grep | pass — the charge sheet is read in `scripts/demo.js` and passed in as a string |

**Not verified, and why:**

- **Verdict quality.** Out of scope by §8. The three verdicts agreed on
  `not justified`; whether that is *correct* is not this project's gate.
- **A real corrective retry.** No call failed validation in the successful run,
  so the retry path has still only run against the fake client.
- **A real budget abort.** The run cost $0.001127 against a $5.00 cap; the gate
  was never triggered live. Covered by tests against fabricated costs only.
- **Mode B.** Not built this turn. The pipeline takes a single `modelId`.
- **The free-tier 403 path as anything but a handled failure.** We know the
  auto-pick can select an uncallable model; we have not decided what the
  product should do about it (see §8, Left open).

## 7. Audit trail

Commits in this turn:
- `b7fe3a8` — the seven personas as data
- `9dbd44c` — representative and judge prompt assembly
- `03af6ba` — live model-list selection, price then context
- `5269d31` — pipeline: 4 representatives then 3 judges
- `27e13a7` — `npm run demo`, the real-run CLI
- `3df66b8` — `DEMO_MODEL_ID` override for the demo
- (this commit) — this record

Model calls: 21 across three runs (7 + 7 + 7). Cost incurred: **$0.001127**,
all of it in the third run. Two untracked probe scripts used to inspect the
live model list during the run were deleted, not committed.

**Locked this turn:** nothing in `spec.md` yet. §5's two proposals are for the
user to accept first.

## 8. Proposed §9 resolutions

This turn was designated by turn 2 to settle two `spec.md` §9 open items. Both
proposals below are **not yet locked** — they need the user's word, then a
commit that edits `spec.md` §9 (and §3, and `decisions.md`).

### 8.1 Max speech length

§9: *"Set after the first real run reports token counts."* The run reported
them: representative completion tokens were 435, 471, 1581, 516, and the
resulting judge prompt was ≈ 2,200 tokens. `MIN_CONTEXT_TOKENS` in
`model-select.js` (12,000) was a pre-flight estimate of charge sheet + four
1,500-token speeches + instructions + retry margin; the real run came in at
roughly a third of that.

**Proposal (recommended): cap each representative speech at 2,000 completion
tokens** — a `max_tokens: 2000` on the representative calls only, comfortably
above the observed 1,581. Rationale:

- It bounds the experiment. Two runs stay comparable even if one model is
  much more verbose than another.
- The worst case stays inside a small model's context: charge sheet (~1,100)
  + 4 × 2,000 + persona and contract (~1,100) ≈ 10,200 tokens of judge input,
  still under the 12,000 floor, which keeps that floor meaningful rather than
  making it a number to raise.
- Judges are left uncapped; a verdict's `reasoning` is the point of the run
  and the longest observed (1,096 tokens) is not close to a limit.

Alternative, if you would rather not touch the call code this cycle: **declare
that speech length is not separately constrained**, and that the 12,000-token
context floor — with its ~4× margin over this run — is the only guardrail.
Weaker on comparability; zero code.

Either way, `spec.md` §9's "Max speech length" bullet moves to §5 as a
**[LOCKED]** line stating the decision, and `decisions.md` gains an entry.

### 8.2 Concurrency versus the budget gate

§9 / D-008 named three candidates: make the gate concurrency-safe by reserving
against the cap before dispatch; drop the parallelism; or batch each stage
under one reservation. `pipeline.js` shipped sequential — de facto the second.

**Proposal (recommended): adopt "drop the parallelism" and lock it.**

- The gate stays trivially correct: checked before each call, run aborts
  exactly at the cap, no race.
- Reserving-before-dispatch requires reserving the *maximum possible* cost of a
  call, which is a local cost estimate — and §6 forbids those. Doing option 1
  honestly is expensive; batching (option 3) has the same problem.
- Throughput is not a project goal. The successful run was 65 s sequential.
  There is no UI and streaming is excluded (§8), so nothing is waiting on it.
- Revisit only if a UI and a concrete latency requirement appear.

Concretely: `spec.md` §3 changes "in parallel" to "in sequence, isolated from
each other" in the diagram and drops the "parallelism … is not yet
implemented" caveat; §9's concurrency bullet is replaced by a pointer to a new
**D-009** in `decisions.md` recording the choice and that it is revisitable.

## 9. Left open

- **The two §5 proposals**, pending the user's decision.
- **The free-tier 403.** The price-first auto-pick can select a model the key
  cannot call. Today the run just fails seven times and reports it. Options not
  yet discussed: skip to the next-cheapest candidate on a 403, require
  `DEMO_MODEL_ID` when the cheapest is `:free`, or leave it as a documented
  operator concern. Not decided.
- **Mode B** (per-agent model mapping) is unbuilt.
- **`npm run lint`** is still documented in `CLAUDE.md` and not implemented.
- **Run persistence and listing** (§6): `scripts/demo.js` writes one JSON file
  per run to `runs/`; there is no listing command and nothing in `src/`
  reads them back.
- **Merge.** This branch stays unmerged by instruction.

**Rules written into `CLAUDE.md` this turn:** none. No correction was issued.

**Milestone:** the tribunal has run end to end against a live model —
four speeches, three verdicts, one protocol, $0.001127 — with the harness,
validator, recorder and budget gate all exercised against real API output for
the first time.
