# Specification — The Tribunal

Status legend: **[LOCKED]** confirmed by use, do not change without a new turn.
**[OPEN]** not yet decided, agent must ask.

---

## 1. Intent

Given a charge sheet, produce three independent judicial opinions on whether an
act was justified, together with a complete record of how each was reached and
what the run cost.

The system is a study of whether character comes from the prompt or from the
model. That is why the same seven personas run under two model configurations
and why the cost of each configuration is measured.

## 2. Inputs

| Input | Source | Status |
|---|---|---|
| Charge sheet | User, at runtime, via a text field | **[LOCKED]** |
| 7 agent personas | Fixed in `docs/agent-profiles.md` | **[LOCKED]** |
| Model configuration | User choice, two modes (§4) | **[LOCKED]** |
| Budget cap | Config, default 5.00 USD per run | **[LOCKED]** |

The charge sheet is free text. `fixtures/case-t001.md` is the reference case
used for development and tests — it is example input, not built-in content.

**[OPEN]** Whether the user may edit persona prompts in the UI. Default
assumption: no. Personas were supplied by the course and are fixed.

## 3. Pipeline

```
charge sheet
     |
     +--> 4 representatives, in parallel, isolated from each other
     |      Jon Snow (defense), Tyrion (defense),
     |      Daenerys (prosecution), Grey Worm (prosecution)
     |      -> 4 speeches
     |
     +--> 3 judges, in parallel, isolated from each other
            input: charge sheet + all 4 speeches + own persona
            -> 3 verdicts
                 |
                 +--> protocol + cost report
```

**[LOCKED]** Representatives receive the charge sheet only. They do not see
each other's speeches and do not rebut.

**[LOCKED]** Judges receive the charge sheet, all four speeches, and their own
persona. They never see another judge's output.

**[LOCKED]** The system does not aggregate, rank, or reconcile the three
verdicts, and does not impose a sentence. Three opinions stand side by side.

**[LOCKED]** A representative's assigned seat fixes only their procedural role,
not their conclusion. The persona reasons in character and may concede.

## 4. Model configuration modes

**Mode A — single model.** All seven agents run on one model chosen by the user.

**Mode B — per-agent models.** Each of the seven agents is bound to a specific
model by a fixed mapping in config.

**[LOCKED]** Mode B uses a deterministic mapping, not random assignment per run.
Randomising would make two runs incomparable and destroy the experiment.

**[LOCKED]** Model IDs are never hardcoded in source. The available list is
fetched from OpenRouter at startup and filtered; the mapping lives in config.

**[LOCKED]** Prefer zero-cost models. Selection filters on price first,
capability second. Free-tier models change often, so the filter is by advertised
price from the live model list, never by a remembered model name.

## 5. Output contract

Every agent returns JSON. The harness validates before accepting.

**Representative:**
```json
{
  "agent_id": "jon_snow",
  "seat": "defense",
  "speech": "string",
  "key_points": ["string"]
}
```

**Judge:**
```json
{
  "judge_id": "barak",
  "verdict": "justified",
  "reasoning": "string",
  "key_factors": ["string"]
}
```

**[LOCKED]** `verdict` accepts exactly `"justified"` or `"not justified"`.
Any other value is a validation failure, not a variant to display.

**[LOCKED]** `seat` accepts exactly `"defense"` or `"prosecution"`.

**[LOCKED]** On validation failure the harness retries once with a corrective
instruction, then records the failure and continues. A failed agent appears in
the protocol as failed. The run is not silently shortened.

## 6. Protocol and cost

**[LOCKED]** The protocol records, for every model call: agent id, model id,
prompt tokens, completion tokens, cost, duration, timestamp, attempt number,
and validation outcome.

**[LOCKED]** The run summary shows total cost, total tokens, and total duration.

**[LOCKED]** Cost is computed from the token counts and prices the API returns,
never from a local estimate.

**[LOCKED]** The budget gate is enforced in code. Before each call the harness
checks the running total; if the next call could exceed the cap, the run stops
and reports which agents completed. Willpower is not a control.

**[LOCKED]** Every completed run is persisted and listable, with its
configuration, so two runs can be compared later.

## 7. Acceptance criteria — turn 1

A turn is done when all of these pass, verified by running them, not by claim:

1. `npm test` green.
2. A run against `fixtures/case-t001.md` produces 4 speeches and 3 verdicts.
3. Every verdict value is one of the two allowed strings.
4. Feeding the validator a malformed response, a third verdict value, and an
   empty response each produce a handled failure, not a crash.
5. Setting the cap to a value below one call's cost aborts the run cleanly and
   reports it.
6. The protocol for the run contains one record per call, and the totals match
   the sum of the records.
7. No secret appears in `git log -p`.

## 8. Deliberately excluded

- Judging the quality of a judge's legal reasoning. Not verifiable, not our gate.
- Authentication, user accounts, multi-tenancy.
- Streaming output.
- Any second case beyond free-text input.

## 9. Open decisions

- **[OPEN]** Persistence: local JSON files or Supabase. Deciding after turn 1
  shows whether run records need querying.
- **[OPEN]** Deployment target. Not needed until the pipeline works.
- **[OPEN]** Whether personas are user-editable (§2).
- **[OPEN]** Max speech length. Needs measurement: judge input is charge sheet
  plus four speeches, and free models have small context windows. Set after the
  first real run reports token counts.