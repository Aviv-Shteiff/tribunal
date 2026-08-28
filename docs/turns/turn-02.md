# Turn 02 — The harness

Date: 2026-08-28
Branch: `turn-02-harness`
Commit at start: `d4dac52`

---

## 1. Intent

Build the mechanical layer between this project and OpenRouter — one call path,
one validator, one retry rule, one budget gate, one protocol recorder — so that
when personas arrive in a later turn, no agent code touches the network, guesses
an output shape, or is trusted to stop spending.

Nothing in this turn calls a real model. No personas, no UI, no HTTP in tests.

## 2. Specification

Touches `spec.md` §5 (output contract), §6 (protocol, cost, budget gate) and the
failure-path expectations in `CLAUDE.md`. Locks nothing new in `spec.md`; it
implements what §5 and §6 already fixed.

Done means: the eight required test cases pass against a fake client, every
model call in `src/` goes through one function, and every number the recorder
reports is a sum of recorded values.

**Points the spec was silent on, and how they were decided.** All three were put
to the user before any code was written, and answered by the user:

- **What "could exceed the cap" means.** §6 requires the check *before* a call,
  but a call's cost is only known *after* it, and §6 forbids local estimates.
  Decided: the gate blocks when `spent + reserve >= cap`, where `reserve` is the
  most expensive call recorded so far this run and is `0` before the first call.
  The reserve is a recorded value, not an estimate. Consequence: under a
  positive cap the first call always proceeds, and a cap set below one call's
  cost aborts the run after that first call.
- **Retry scope.** §5 grants one corrective retry to *validation* failure and
  says nothing about transport failure. Decided: a transport, HTTP or envelope
  failure is recorded and returned as failed immediately, with no retry.
- **A sequencer this turn.** Item 4's "reports which agents had completed" and
  the required budget-stop-mid-run test both need something that iterates over
  calls, and there are no agents yet. Decided: in scope, as
  `src/run-harness.js` — a loop over caller-supplied requests, not a pipeline.

**Decided during execution, smaller, flagged here rather than asked:**

- **A cost the API does not report.** §6 forbids estimating it, so it stays
  `null`. Such a call contributes nothing to `costUsd` and is counted in
  `callsWithUnknownCost`, on both the gate and the totals, so a total is never
  quietly short.
- **Request timeout.** `CLAUDE.md` names timeout as a failure path that must
  exist; the spec sets no value. 60 s, a named constant in `model-client.js`.
- **Extra fields in a model response** are dropped, not rejected. Only contract
  fields survive validation.

## 3. Context supplied

Given: `CLAUDE.md`, `docs/spec.md`, `docs/decisions.md`. Explicitly withheld:
`docs/agent-profiles.md` and `fixtures/case-t001.md` — this turn touches neither
prompts nor case text, and reading them would invite persona work that was not
asked for.

Stated conventions: no dependency beyond a test runner; branch `turn-02-harness`;
plan first, wait for approval, no code in the planning message.

## 4. Plan

Approved as proposed, with the three questions in §2 answered first:
(b) for the budget rule, no transport retry, run-harness in scope.

1. Branch off `main`.
2. `package.json` + `src/config.js`.
3. `src/protocol.js` — the record shape the rest of the harness speaks in.
4. `src/validate.js` + tests.
5. `src/model-client.js` + fake transport.
6. `src/retry.js` + tests.
7. `src/budget.js` + tests.
8. `src/run-harness.js` + budget-stop-mid-run test.
9. `npm test` green; report which of §7's criteria this turn reaches.
10. Write this document, commit, stop. No merge without the user's word.

## 5. Execution

Followed the plan. Two deviations, both small:

- Steps 6 and 7 were swapped — `budget.js` was written before `retry.js`, because
  `retry.js` consults the gate and the test file imports it. Ordering only.
- `npm test` was first written as `node --test test/`, which Node reads as a
  file path and not a directory. Corrected to an explicit glob,
  `node --test "test/*.test.js"`, and `engines.node` raised to `>=22`, the first
  version whose test runner accepts a glob argument.

Nothing was built that was not asked for. **Zero dependencies were added** — not
even a test runner: Node's built-in `node:test` covers it, so `npm install`
installs nothing. `npm run lint` is still not implemented; a linter is a
dependency and this turn did not need one.

## 6. Verification

`npm test` — 49 tests, 49 pass, 0 fail. All eight required cases are covered:

| Check | Method | Result |
|---|---|---|
| Well-formed response | `validate.test.js`, both shapes | pass |
| Response wrapped in code fences | `validate.test.js`, tagged and bare fences | pass |
| Malformed JSON | `validate.test.js` + `retry.test.js` | pass, handled failure |
| A third verdict value | `validate.test.js`, `retry.test.js` | rejected, incl. case-only and prose variants |
| Empty response | `validate.test.js` (4 forms), `retry.test.js` | pass, handled failure |
| A retry that succeeds | `retry.test.js` | pass — 2 calls, 2 records, attempts 1 and 2 |
| A retry that fails | `retry.test.js` | pass — failed result returned, never thrown, no third attempt |
| Budget stop mid-run | `run-harness.test.js` | pass — 3 of 4 agents complete, 4th never called |
| spec §7.1 `npm test` green | ran it | pass |
| spec §7.4 malformed / third verdict / empty are handled, not crashes | tests above | pass |
| spec §7.5 cap below one call's cost aborts cleanly and reports | `budget.test.js`, `run-harness.test.js` | pass |
| spec §7.6 one record per call, totals match the sum of records | `protocol.test.js`, `run-harness.test.js` | pass |
| spec §7.7 no secret in `git log -p` | `git log -p` grepped for key patterns | pass — only the pre-commit hook's own pattern string matches |
| No model name hardcoded in `src/` | grep for provider and model-name substrings | pass — none; model ids arrive as arguments |
| No `fetch` outside the single call path | grep `src/` | pass — one call site, in `model-client.js` |
| Nothing in `src/` imports `fixtures/` (D-001) | grep | pass |

**Not verified, and why:**

- **spec §7.2** — a real run producing 4 speeches and 3 verdicts. Needs personas
  and live calls; neither exists yet. Out of scope this turn by instruction.
- **spec §7.3** — every verdict value is one of the two allowed strings *in a
  real run*. The validator is proven to reject anything else; no real verdict
  has been produced to check.
- **The real HTTP transport has never executed.** `openRouterTransport` is
  covered only by the fake that replaces it. Its URL, auth header, timeout and
  the shape of a live OpenRouter response are unproven until the first real
  call. The first live run is the test.
- **Cost arithmetic against real API values.** The gate and totals are tested on
  fabricated costs. Whether OpenRouter populates `usage.cost` on the models this
  project will use is unknown — hence the `null` handling.
- No linting, no type checking. Neither tool is installed.

Failures found while working: one, the `node --test` path form, caught by
running the suite. Cost to fix: one line.

## 7. Audit trail

Commits in this turn:
- `9b19e46` — config and protocol
- `65fbdf4` — output contract validation
- `e40aba8` — single model call path
- `73465c1` — budget gate
- `782be03` — corrective retry
- `d9fa64f` — run sequencer
- (this commit) — this record

Model calls: none. Cost incurred: $0.00. No network request was made in this
turn, by tests or otherwise.

**Locked this turn:** nothing new in `spec.md`. The three decisions in §2 are
implementation rules under existing locked sections, not new spec entries. They
are candidates to be written into `spec.md` §6 once a real run confirms the
reserve rule behaves sanely against live costs.

**Left open:**
- §3 has representatives and judges running *in parallel*; §6 requires the
  running total to be checked *before each call*. Concurrent calls would race
  that check. `run-harness.js` is sequential, which keeps the gate meaningful,
  and says so in a comment. This must be settled by the turn that builds the
  pipeline — either the gate becomes concurrency-safe, or parallelism is
  dropped, or calls are batched under a reservation. It is a real conflict
  between two locked sections and should not be resolved silently in code.
- Whether a call with no reported cost should be allowed to continue a run at
  all. Currently it is counted and the run proceeds.
- `npm run lint` is documented in `CLAUDE.md` but not implemented.
- Persistence of a completed run (§6, "every completed run is persisted and
  listable") is not built. The recorder holds records in memory only.

**Rules written into `CLAUDE.md` this turn:** none. No correction was issued.

**Milestone:** a model response can now be called for, validated, retried once,
recorded and paid for — and the run can be stopped by the cap — with none of it
touching the network, and with no dependency installed.

---

## Addendum — the parallel/gate conflict, recorded

Added after the turn's work was reviewed, on instruction: the conflict reported
under "Left open" was to be written down rather than left as a comment in
`run-harness.js`.

- `docs/spec.md` §9 gains an **[OPEN]** entry naming the conflict, the three
  candidate resolutions, and that §3's "in parallel" currently describes the
  intended pipeline and not the implemented harness.
- `docs/decisions.md` gains **D-008**, why sequential was chosen for now: with no
  agents in the harness yet, nothing was gained by racing, and between a gate
  that works and parallelism that does not, the gate wins. It records that this
  is a deferral, and that the likely fix is to reserve against the cap before
  dispatch rather than to check after.

Resolution is turn 3's, when the personas exist and there is a stage worth
parallelising. Sequential behaviour is unchanged; no code was touched.

`npm test` re-run after the documentation change: 49 pass, 0 fail. Merged to
`main` with `--no-ff` so the branch stays legible in the history.

A "see §9" pointer was added under the §3 pipeline diagram, so a reader who
starts at the diagram learns the parallelism is not yet implemented without
having to reach §9 first. Documentation only; no code touched.
