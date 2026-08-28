# CLAUDE.md — The Tribunal

Multi-agent deliberation system. Seven LLM agents (4 representatives, 3 judges)
argue and rule on a charge sheet supplied at runtime. Course project for ASE-26.

**Read before acting:** `docs/spec.md`, `docs/decisions.md`.
Read `docs/agent-profiles.md` and `fixtures/case-t001.md` only when the task
touches prompts or test data — they are large and rarely needed otherwise.

---

## How this project is graded

The record of how the work was directed matters more than the running app.
A change that is not documented in `docs/turns/` did not happen.
Never skip the audit trail to save time.

## Standing rules

**Scope**
- Do not implement anything not written in `docs/spec.md`. If the spec is
  silent, stop and ask — do not choose for me.
- Do not add dependencies, frameworks, config files, or abstraction layers
  that the current task does not require.
- Do not refactor code you were not asked to touch.

**Verdicts**
- A judge's verdict field accepts exactly two values: `justified` or
  `not justified`. Never invent a third. Never emit prose in that field.
- Never aggregate the three verdicts. No majority, no combined ruling,
  no sentence. Three separate opinions is the output.
- Judges never see each other's output. Representatives never see each
  other's speeches. Breaking isolation is a defect, not a feature.

**Cost**
- Every model call passes through the budget gate. No direct HTTP calls to
  OpenRouter from anywhere else in the codebase.
- The run aborts when the cap is reached. It does not warn and continue.
- Never hardcode a model name. Model IDs come from config or the live
  OpenRouter model list.

**Git**
- Commit before starting any task that touches more than one file.
- One logical change per commit. The message says *why*, not *what*.
- Never commit `.env`, API keys, or any file matching `*secret*`.
- Work on a branch named `turn-NN-short-slug`. Merge only after the gate passes.

**Documentation**
- When I correct you, write the correction into this file as a rule before
  continuing. Record the rule, not the complaint.
- Update `docs/spec.md` when a decision is locked. Append to
  `docs/turns/turn-NN.md` — never rewrite a past turn.

## What good work looks like

- The output shape is enforced in code, not requested in a prompt. Parse and
  validate every model response; a malformed response is a handled case.
- Failure paths exist before the happy path is polished: timeout, refusal,
  malformed JSON, rate limit, budget exhausted.
- Tests check the harness against the spec, not the model's opinions.
  Judge reasoning quality is not testable and is not our concern here.
- Every number shown to the user (cost, tokens, duration) traces to a
  recorded value, never an estimate presented as fact.

## How to approach work

1. Restate the intent in one sentence before planning.
2. Write the plan as ordered steps and show it to me. Wait.
3. Execute only after I approve the plan.
4. Verify against the acceptance criteria in `docs/spec.md`, not against
   your own reading of the code.
5. Report what you verified and what you did not.

Prefer the smallest change that satisfies the step. If a step turns out
larger than planned, stop and say so rather than expanding silently.

## When to stop and ask

- The spec does not cover the case in front of you.
- Two instructions conflict.
- You are about to change a file outside the current task's scope.
- A fix has failed twice. Do not attempt a third. Report and wait.
- Cost per run would exceed the configured cap under normal use.
- You want to add a dependency.

## Commands

```
npm install
npm run dev      # local server, http://localhost:3000
npm test         # harness tests — must pass before any merge
npm run lint
```

## Vocabulary

- **turn** — one documented cycle of work (see `docs/turns/TEMPLATE.md`).
- **run** — one execution of the tribunal: 4 speeches + 3 verdicts + protocol.
- **representative** — one of the 4 advocate agents.
- **protocol** — the full record of a run: every call, prompt, response,
  token count, and cost.