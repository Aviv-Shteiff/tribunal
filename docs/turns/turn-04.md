# Turn 04 — Mode B, and both configurations on record

Date: 2026-08-29
Branch: `turn-04-mode-b`
Commit at start: `7682d08`

---

## 1. Intent

Give the study its second half: run the same seven personas with each agent on
its own model, chosen live the way Mode A chooses its one, so there is a real
run of both configurations on record and the protocol shows which model
actually spoke for each agent — the fact the Mode A vs Mode B comparison in
spec.md §1 turns on.

## 2. Specification

Touches `spec.md` §4 (model configuration modes) and §6 (the protocol already
records model id per call). Locks one new line in §4 and records D-011 and
D-012.

Done means: `buildModelMap` maps the seven agents to seven distinct live
models, cheapest first, judges held to the 12k context floor; a `--mode`
switch selects Mode A (unchanged) or Mode B through the same pipeline, gate,
retry and recorder; the protocol record for each call carries the model that
served it; `npm test` green with Mode B's mapping covered against the fake
client; and one real Mode B run against `fixtures/case-t001.md` is on record.

**Points the spec was silent on, and how they were decided** (all put to the
user before code, answered by the user):

- **Representative context floor.** Judges need `MIN_CONTEXT_TOKENS` (12k).
  Representatives see only the charge sheet plus their own 2,000-token cap, so
  `REPRESENTATIVE_MIN_CONTEXT_TOKENS` = 6,000. A lower floor lets Mode B reach
  further down the price list before distinct models run out. (D-011)
- **Distinct models or reuse.** The live list has 21 zero-price models over the
  12k floor, so seven distinct suitable models is not the constraint. Reuse
  collapses Mode B toward Mode A for the shared agents, so `buildModelMap` never
  reuses: it fails, naming the agent it cannot place, and the run does not
  start. Reuse is a mapping the user would configure on purpose, not a
  fallback. (D-011)
- **The free tier.** Turn 3 established this account 403s on `:free` models. A
  pure cheapest-first Mode B map is almost entirely `:free` (and, at the top,
  non-chat models like `google/lyria-3-pro-preview`). `buildModelMap` still
  prefers zero-cost per §4; `includeZeroPrice: false` — surfaced as
  `demo --mode=b --skip-free` — drops $0 models from the pool for a real run.
  The real run used it. (D-012)

**Decided during execution, smaller, flagged here rather than asked:**

- `runTribunal` gains an optional `modelByAgent`; when absent, every request
  uses the single `modelId` exactly as before, so Mode A is byte-identical.
- The run record for Mode B carries both `modelByAgent` (agent → id) and
  `modelAssignments` (agent → the full priced model object). Mode A's record
  shape is untouched.
- `demo.js` rejects unknown arguments and `--skip-free` outside Mode B, rather
  than ignoring them.

## 3. Context supplied

Given: `CLAUDE.md`, the updated `docs/spec.md` (with the D-009/D-010 locks from
turn 3), `docs/decisions.md`, and the instruction to read `docs/agent-profiles.md`
and `fixtures/case-t001.md` only if the task touched them — it did not, beyond
the fixture being the run input, which `demo.js` already reads at the edge.

Stated conventions: build Mode B and nothing else — no UI, no cross-run
comparison, no statistics; do not touch Mode A's behaviour or its tests; never
hardcode a model id; branch `turn-04-mode-b`; plan and cost estimate first,
wait for approval. Two questions were required to be raised before building
(distinct-vs-reuse, free-tier) and were.

## 4. Plan

Approved as proposed, after the two questions were answered (fail-not-reuse;
`--skip-free` for the real run) and a cost estimate was given (~$0.001–0.002
expected, under $0.01 with retries).

1. Branch `turn-04-mode-b` off `main`.
2. `src/model-select.js` — `REPRESENTATIVE_MIN_CONTEXT_TOKENS` and
   `buildModelMap(models, agents, { includeZeroPrice })`. `selectCheapestModel`
   untouched.
3. `test/model-select.test.js` — normal 7-agent mapping; cheapest-first order;
   an agent with no suitable model → named failure; `includeZeroPrice: false`;
   role floors; id provenance; non-array inputs.
4. `src/pipeline.js` — optional `modelByAgent`; per-request
   `modelByAgent?.[id] ?? modelId`; return adds `modelByAgent`.
5. `test/pipeline.test.js` — a Mode B run through the fake transport records
   the per-agent model id; a Mode A run with no map still uses the single id.
6. `scripts/demo.js` — `--mode=a|b` (default a) and `--skip-free`; Mode B
   prints all seven assignments before any call; run record gains `mode: 'B'`.
7. `npm test` green.
8. One real run: `npm run demo -- --mode=b --skip-free`.
9. `docs/decisions.md` D-011, D-012; `spec.md` §4 lock; this document.
10. Commit per logical change. Do not merge — wait for the user's word.

## 5. Execution

Followed the plan. `npm test` went from 79 to 87 (6 mapping tests, 2 pipeline
tests). Mode A code and its tests were not touched; the new pipeline tests
include one that asserts the Mode A path (`modelId` only, no map) is unchanged.

Nothing was built beyond the four files and the docs. No UI, no comparison
tooling, no statistics. Zero dependencies added.

**The real run** — `npm run demo -- --mode=b --skip-free`,
`runs/run-2026-08-29T11-03-40-272Z.json`:

Assignments printed before any call (agent → model, live price/context):

| Agent | Role | Model | ctx |
|---|---|---|---|
| jon_snow | representative | `mistralai/mistral-nemo` | 131k |
| tyrion_lannister | representative | `inclusionai/ling-3.0-flash` | 262k |
| daenerys_targaryen | representative | `sao10k/l3-lunaris-8b` | 8k |
| grey_worm | representative | `gryphe/mythomax-l2-13b` | 8k |
| barak | judge | `nex-agi/nex-n2-mini` | 262k |
| elon | judge | `ibm-granite/granite-4.0-h-micro` | 131k |
| shamgar | judge | `~deepseek/deepseek-v4-flash-latest` | 1.3M |

Outcome: **3 of 4 speeches, 3 of 3 verdicts, 8 calls, $0.001709.**

- `tyrion_lannister` on `ling-3.0-flash` failed both attempts — attempt 1
  wrapped the JSON in a ```` ```json ```` fence *and* ran to the 2,000-token
  cap, so the object was truncated mid-string and did not parse; attempt 2
  returned empty. `validate.js` rejected both; the judge prompt was told "3 of
  4 representatives responded". This is the D-010 cap and the retry rule doing
  exactly what they are for, on a chatty model — a handled failure, not a
  crash.
- The other three representatives (`mistral-nemo`, `l3-lunaris-8b`,
  `mythomax-l2-13b`) produced valid speeches.
- All three judges produced valid verdicts. `~deepseek/deepseek-v4-flash-latest`
  — the tilde-prefixed id from the live list — was callable.
- `nex-agi/nex-n2-mini` (barak) returned 7,024 completion tokens, uncapped;
  that one call was $0.00074, most of the run's cost.

Verdicts (the run is on record; their quality is out of scope, spec.md §8):

- **barak** (`nex-agi/nex-n2-mini`): **justified** — necessity / defence of
  others; imminent grave threat, no lawful alternative, proportionate.
- **elon** (`ibm-granite/granite-4.0-h-micro`): **justified** — necessary
  defence of others and the realm despite the absence of formal authority.
- **shamgar** (`~deepseek/deepseek-v4-flash-latest`): **not justified** — no
  imminent threat at the moment of the killing, alternatives not exhausted, no
  lawful authority.

Cost/token summary, all traced to recorded values:

| | |
|---|---|
| Calls | 8 (7 agents + 1 retry) |
| Prompt tokens | 10,259 |
| Completion tokens | 13,902 |
| Total tokens | 24,161 |
| Cost | $0.001709 |
| Calls with no reported cost | 0 |
| Recorded call duration (sum) | 121,159 ms |

Total real spend this turn: **$0.001709**, one run.

## 6. Verification

`npm test` — 87 tests, 87 pass, 0 fail.

| Check | Method | Result |
|---|---|---|
| Mode B maps 7 agents to 7 distinct models, cheapest first in agent order | `model-select.test.js` | pass |
| A model is never shared; the list running short fails, naming the agent | `model-select.test.js` | pass |
| `includeZeroPrice: false` skips advertised-$0 models | `model-select.test.js` | pass |
| Role floors: a mid-size model serves a representative, not a judge | `model-select.test.js` | pass |
| Mapping never emits an id absent from the input list | `model-select.test.js` | pass |
| Each agent runs on its mapped model; the protocol records which | `pipeline.test.js` (fake transport) | pass |
| Mode A unchanged: no map → every call uses the single `modelId` | `pipeline.test.js` | pass |
| spec §7.1 `npm test` green | ran it | pass — 87/87 |
| spec §7.2 a run produces 4 speeches and 3 verdicts | real Mode B run | 3 of 4 speeches (one handled failure), 3 of 3 verdicts |
| spec §7.3 every verdict value is one of the two allowed strings | inspected run record | pass — justified / justified / not justified |
| spec §7.6 one record per call, totals = sum of records | re-summed the protocol array | pass — 8 records; prompt, completion and cost totals all reconcile |
| No model id hardcoded | grep `src/` and `scripts/`; ids come from the live list or `DEMO_MODEL_ID` | pass |
| Mode A behaviour / tests untouched | diff review; the existing pipeline subtests are unchanged and green | pass |

**Not verified, and why:**

- **Verdict quality** — out of scope (spec.md §8).
- **A clean 4-of-4 Mode B run** — `ling-3.0-flash` failed the tyrion slot. The
  pipeline handled it, but a run where every cheap model produces valid JSON has
  not been seen. Re-running would pick the same models (deterministic) unless
  the live list moves.
- **The `--skip-free` pool's non-JSON risk** — the two 8k-context roleplay
  finetunes (`l3-lunaris-8b`, `mythomax-l2-13b`) happened to produce valid
  objects this run; that is not guaranteed.
- **Mode B budget abort** — the run cost $0.0017 against a $5 cap; the gate was
  never triggered live in Mode B.

## 7. Audit trail

Commits in this turn:
- `d751d42` — `buildModelMap` + tests
- `29d092c` — `runTribunal` takes a per-agent model map + tests
- `8d79c34` — `demo --mode=b --skip-free`
- (this commit) — docs: D-011, D-012, §4 lock, this record

Model calls: 8, one real Mode B run. Cost incurred: **$0.001709**.

**Locked this turn:**
- `spec.md` §4 — the Mode B mapping rule (walk agents in fixed order, cheapest
  live model clearing the role floor, never shared, fail-with-agent-name).

**Left open:**
- **No modality filter.** `selectCheapestModel` and `buildModelMap` filter on
  price and context only. Without `--skip-free`, the top of the list includes
  non-chat models (`google/lyria-3-pro-preview`, a music model). Harmless with
  `--skip-free` on this account, but a pure cheapest-first run on an account
  that *can* use the free tier would try to send a chat completion to a music
  model. A `type`/architecture filter is the fix; not built this turn.
- **Cheap models and the output contract.** Obscure cheap models fail JSON
  validation more often (1 of 7 this run). The retry rule and the
  drop-and-tell-the-judges path absorb it, but Mode B runs will be noisier than
  Mode A on a solid model.
- **Persistence / listing** (§6) — still one JSON file per run in `runs/`, no
  listing command. Carried from turn 3.
- **`npm run lint`** — still documented in `CLAUDE.md`, not implemented.

**Rules written into `CLAUDE.md` this turn:** none. No correction was issued.

**Milestone:** both model configurations have now run for real against
`fixtures/case-t001.md` — Mode A (turn 3, one model, $0.0011) and Mode B (this
turn, seven models, $0.0017) — each with a full protocol naming the model
behind every call.
