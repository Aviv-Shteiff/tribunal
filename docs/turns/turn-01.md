# Turn 01 — Project conception and documented scaffold

Date: 2026-08-28
Branch: `turn-01-conception`
Commit at start: (initial commit)

---

## 1. Intent

Fix the shape of the problem before any code exists, so that the first build
turn has a specification to be verified against rather than one written
afterwards to fit whatever was built.

## 2. Specification

This turn produces documentation only. Done when:

- `docs/spec.md` states the pipeline, the isolation rules, the output contract
  and the budget rule, each marked LOCKED or OPEN.
- `docs/decisions.md` records the reasoning behind every non-obvious choice.
- `CLAUDE.md` carries the standing rules and the stop-and-ask conditions.
- `docs/turns/TEMPLATE.md` exists so later turns do not invent a format.
- The repository contains no source code yet, and no secret.

Decided here, having been unstated in the brief:
- The charge sheet is runtime input (D-001).
- Mode B uses a fixed mapping, not random (D-002).
- `verdict` is a closed two-value field (D-003).

## 3. Context supplied

Course lecture decks (modules 1–17), the project brief, and the tribunal
information package. The information package supplied the seven personas and
the scope note limiting the tribunal to justified / not justified.

Withheld from the repository: the lecture decks themselves. They shaped the
process but are not project context, and would cost tokens every session.

## 4. Plan

1. Write the specification, marking each item LOCKED or OPEN.
2. Write the decisions file for anything a future reader would question.
3. Write CLAUDE.md, under 200 lines, covering standards, quality bar,
   approach, and stop conditions.
4. Write the turn template.
5. Copy the personas and the reference case into the repository as fixtures.
6. Add `.gitignore`, `.env.example`, and a secret-scanning pre-commit hook.
7. Commit, verify the hook, push.

## 5. Execution

<!-- fill in after the work -->

## 6. Verification

| Check | Method | Result |
|---|---|---|
| Hook blocks a committed secret | commit a dummy key, expect rejection | |
| `.env` is ignored | `git check-ignore -v .env` | |
| No secret in history | `git log -p \| grep -iE 'sk-\|api[_-]?key'` | |
| CLAUDE.md under 200 lines | `wc -l CLAUDE.md` | |
| Every spec item marked | read through, count unmarked | |

Not checked this turn: anything about runtime behaviour. No code exists.

## 7. Audit trail

Commits in this turn:
- `<sha>` — <message>

Model calls: none. Cost: 0.00.

**Locked this turn:** D-001 through D-007, and the §3–§6 rules in spec.md.

**Left open:** persistence layer, deployment target, persona editability,
maximum speech length. Each needs a measurement or a real run to settle.

**Rules written into CLAUDE.md this turn:** initial set.

**Milestone:** a specification exists that a later build can be verified
against.