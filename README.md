# The Tribunal

A multi-agent deliberation system. You supply a charge sheet; four
representative agents argue for and against, three judge agents each rule
independently on whether the act was justified, and the system reports every
opinion, the full protocol of how it was produced, and what the run cost.

Course project for ASE-26, Agentic Software Engineering.

## What it does

Four representatives — two defending, two prosecuting — each read the charge
sheet and speak in character, without seeing each other. Three judges then read
the charge sheet and all four speeches, and each writes an opinion, without
seeing each other. The three opinions are not combined into one ruling and no
sentence is imposed.

The system runs in two configurations: all seven agents on one model, or each
agent bound to its own model. Comparing the two is the point — it asks whether
a character comes from its prompt or from the model behind it.

Every run reports its token usage and cost, and stops rather than exceeding a
configured cap.

## Repository

```
CLAUDE.md              standing rules for the coding agent
docs/spec.md           what the system must do
docs/decisions.md      why it is that way
docs/agent-profiles.md the seven fixed personas
docs/turns/            one record per cycle of work
fixtures/case-t001.md  reference case used in development and tests
```

The charge sheet is user input. The reference case is an example, not the
system's content.

## Setup

```
cp .env.example .env      # add your OpenRouter key
npm install
npm test
npm run dev
```

Never commit `.env`. A pre-commit hook scans for keys; install it with
`git config core.hooksPath scripts/hooks`.

## Deploying

The repository is prepared for Render's free plan (`render.yaml`), with the run
store on Turso's free tier. Deploying is a manual step — the config here does
not deploy anything. Both free tiers work without a payment method.

**1. Create a free Turso database.** Render's free plan has no persistent disk,
so the SQLite database lives on Turso (hosted libSQL) instead — see
`docs/decisions.md` D-017.

```
curl -sSfL https://tur.so/install.sh | bash    # the Turso CLI
turso auth signup                              # GitHub sign-in, no card
turso db create tribunal
turso db show tribunal --url                   # -> TURSO_DATABASE_URL
turso db tokens create tribunal                # -> TURSO_AUTH_TOKEN
```

The schema is created automatically on first run (`CREATE TABLE IF NOT
EXISTS`).

**2. Create the Render Blueprint.** *New → Blueprint*, connect this repository,
let it read `render.yaml` — one web service (`tribunal`) on the `free` plan.

**3. Set the environment variables** when prompted (listed in `render.yaml` by
name only, `sync: false`):

- `OPENROUTER_API_KEY` — the OpenRouter key.
- `RUN_BUDGET_USD` — the per-run USD cap (e.g. `5.00`).
- `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` — from step 1.
- `DEMO_MODEL_ID` — optional but recommended: a cheap paid model id such as
  `openai/gpt-oss-20b`, so **Mode A** works. Without it, Mode A auto-picks a
  free-tier model this account cannot call (`docs/decisions.md` D-012). Mode B
  is unaffected.

**4. Deploy.** The build runs `npm ci`; the service starts with `npm start`,
binding `0.0.0.0` on Render's injected `PORT`. Node version comes from
`engines.node` (`>=22.6.0`). Render's free plan sleeps the service after ~15
minutes of inactivity; the next request cold-starts it.

Once live, anyone with the URL can trigger a real, paid model run. The budget
gate is per-run, not cumulative — read `docs/decisions.md` D-016 before making
the URL public.

## Note on the record

`docs/turns/` is the working record of how this project was built: the intent
behind each cycle, the plan, what was verified, and what was locked. It is kept
because the reasoning behind a choice is clearest at the moment it is made and
cannot be reconstructed later.