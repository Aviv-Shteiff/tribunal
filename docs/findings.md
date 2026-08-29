# Findings — manual tribunal runs, 2026-08-29

## 1. What was tested

On 2026-08-29 the tribunal was run seven times through the browser UI against
the default reference charge sheet (Case T-001, *The Realm v. Jon Snow*): four
runs in Mode A and three in Mode B. Mode A put all seven agents on one model,
`openai/gpt-oss-20b` (set through `DEMO_MODEL_ID`). Mode B gave each agent its
own model, chosen cheapest-first from the live OpenRouter list with the free
tier skipped. `spec.md` §1 frames the project as a study of whether character
comes from the prompt or from the model, which is why the same seven personas
are run under two model configurations. These seven runs are that comparison
for a single case: the same personas and the same charge sheet, once per
configuration group. This document records the outcomes; it does not analyse
them.

## 2. Results

| Run | Mode | barak | elon | shamgar | Representative failures |
|---|---|---|---|---|---|
| A1 | A | not justified | not justified | not justified | none |
| A2 | A | not justified | not justified | not justified | none |
| A3 | A | not justified | not justified | not justified | none |
| A4 | A | not justified | not justified | not justified | none |
| B1 | B | justified | not justified | FAILED validation | none |
| B2 | B | not justified | justified | justified | none |
| B3 | B | not justified | not justified | justified | daenerys_targaryen (FAILED validation) |

Notes on the table:

- "FAILED validation" means the agent's response did not pass the output
  contract after the one permitted retry, so no verdict (or no speech) was
  recorded for it. It is distinct from "not attempted", which would mean the
  budget gate stopped the run before that call. No run was stopped by the
  budget gate, and no agent was "not attempted".
- In B1, two of the three judges returned a verdict. In B3, all three judges
  returned a verdict even though one representative's speech had failed
  validation — judges rule on whichever speeches survive.
- Every Mode A run had all four representatives succeed.
- The model assigned to each agent in each Mode B run is recorded in that
  run's file (§4).

## 3. What this suggests

Two plain observations from these seven runs:

- The three judges returned the same verdict — not justified — in all four
  Mode A runs. They returned the same verdict in none of the three Mode B
  runs.
- Mode A recorded no validation failures across its four runs. Mode B recorded
  two across its three runs: one judge in B1 and one representative in B3.

These observations are consistent with model choice affecting how consistent
the tribunal's output is — both whether the three judges agree and how often a
response is malformed. They do not establish it. Four Mode A runs and three
Mode B runs are too few to be statistically confident of any difference. This
section states what the runs showed and what that is compatible with, and
stops there.

## 4. Run files

All runs are saved under `runs/` (git-ignored). Matching the results above to
files:

**Mode B — confident.** Each of the three Mode B results matches exactly one
file, and matches it uniquely:

- B1 → `runs/run-2026-08-29T13-26-55-757Z.json` — barak justified, elon not
  justified, shamgar failed; no representative failures.
- B2 → `runs/run-2026-08-29T13-30-29-448Z.json` — barak not justified, elon
  justified, shamgar justified; all representatives ok.
- B3 → `runs/run-2026-08-29T13-38-24-015Z.json` — barak not justified, elon
  not justified, shamgar justified; daenerys_targaryen failed.

An earlier Mode B file exists, `runs/run-2026-08-29T11-03-40-272Z.json`, from
development on an earlier turn. Its outcome differs from all three above; it is
not one of these runs.

**Mode A — not confident.** All four Mode A results have the identical recorded
outcome (three judges "not justified", four representatives ok), so they cannot
be told apart by content. The `runs/` files with that exact Mode A /
`DEMO_MODEL_ID` profile are:

- `run-2026-08-29T11-34-06-993Z.json`
- `run-2026-08-29T12-33-40-447Z.json`
- `run-2026-08-29T12-55-59-169Z.json`
- `run-2026-08-29T13-08-00-004Z.json`
- `run-2026-08-29T13-34-42-131Z.json`

That is five files for four runs, and some Mode A runs on 2026-08-29 were made
during turn 5 and turn 6 verification rather than through the browser. The four
browser runs are among these five files, but which four — and in what order —
cannot be determined from the records. A sixth Mode A `DEMO_MODEL_ID` file,
`run-2026-08-29T11-30-39-288Z.json`, has a judge validation failure and is
therefore not one of the four.
