# First prompt for Claude Code

Paste this as the opening message of the first session, after `git init`,
the initial commit, and `git config core.hooksPath scripts/hooks`.

Do not paste it before the repository is committed — the rule below assumes a
restore point exists.

---

Read CLAUDE.md, docs/spec.md and docs/decisions.md before doing anything.
Do not read docs/agent-profiles.md or fixtures/ yet.

This is turn 2 of the project. Turn 1 produced the documentation you just read
and no code. Your job this turn is the harness only — the layer around the
model calls. No personas, no UI, no real API calls.

Build this and nothing else:

1. A `callModel` function that is the single path to OpenRouter. Every model
   call in this project goes through it. It takes a model id, a system prompt,
   a user message, and returns the parsed response plus prompt tokens,
   completion tokens, cost and duration as reported by the API.

2. A validator for the two output shapes in spec.md §5. It accepts a raw string,
   strips code fences if present, parses, and checks the fields. It rejects a
   verdict value that is not exactly "justified" or "not justified".

3. A retry rule: one corrective retry on validation failure, then record the
   failure and return it as a failed result. Never throw past the caller.

4. A budget gate: a running total checked before each call, and a hard stop when
   the next call could exceed the cap from RUN_BUDGET_USD. Stopping reports
   which agents had completed.

5. A protocol recorder that appends one record per call with the fields listed
   in spec.md §6, and computes the run totals from those records.

6. Tests for all of the above, using a fake model client — no network in tests.
   Cover at minimum: a well-formed response, a response wrapped in code fences,
   malformed JSON, a third verdict value, an empty response, a retry that
   succeeds, a retry that fails, and a budget stop mid-run.

Before writing any code: restate the intent of this turn in one sentence, then
give me the ordered plan and the files you intend to create. Wait for my
approval. Do not write code in the same message as the plan.

When the plan is approved, work on a branch named turn-02-harness.

Stop and ask if anything above conflicts with spec.md, or if you find yourself
wanting a dependency beyond a test runner.