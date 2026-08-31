// The run store (spec.md §6: "every completed run is persisted and listable").
// SQLite through Node's built-in node:sqlite — no dependency. The database file
// is local state, git-ignored like runs/ was; it is created on first use.
//
// Four tables: runs, verdicts, speeches, calls. verdicts and speeches each hold
// one row per agent that produced a valid output; calls is the log of every
// model call the lecture requires — one row per call, in call order.
//
// This module only stores and reads back. It does not call models, resolve
// models, validate, or retry.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { JUDGES, REPRESENTATIVES } from '../src/personas.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Local default is the git-ignored db/ directory, created on first use. In a
// deploy, DB_PATH points at a persistent disk mount (Render: /var/data) so the
// database survives restarts — see decisions.md D-016.
export const DB_PATH =
  process.env.DB_PATH || path.join(HERE, '..', 'db', 'tribunal.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id             INTEGER PRIMARY KEY,
  charge_sheet   TEXT    NOT NULL,
  mode           TEXT    NOT NULL,
  model_source   TEXT    NOT NULL,
  started_at     TEXT    NOT NULL,
  completed_at   TEXT    NOT NULL,
  total_cost     REAL    NOT NULL,
  total_tokens   INTEGER NOT NULL,
  stopped        INTEGER NOT NULL,
  stopped_reason TEXT
);

CREATE TABLE IF NOT EXISTS verdicts (
  id        INTEGER PRIMARY KEY,
  run_id    INTEGER NOT NULL REFERENCES runs(id),
  judge_id  TEXT    NOT NULL,
  verdict   TEXT    NOT NULL,
  reasoning TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS speeches (
  id       INTEGER PRIMARY KEY,
  run_id   INTEGER NOT NULL REFERENCES runs(id),
  agent_id TEXT    NOT NULL,
  seat     TEXT    NOT NULL,
  speech   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS calls (
  id                 INTEGER PRIMARY KEY,
  run_id             INTEGER NOT NULL REFERENCES runs(id),
  agent_id           TEXT    NOT NULL,
  model_id           TEXT    NOT NULL,
  prompt_tokens      INTEGER,
  completion_tokens  INTEGER,
  cost               REAL,
  duration_ms        INTEGER NOT NULL,
  attempt            INTEGER NOT NULL,
  validation_outcome TEXT    NOT NULL,
  error_text         TEXT
);
`;

/**
 * Open the database, creating the file and schema if they do not exist.
 * `CREATE TABLE IF NOT EXISTS` is the whole migration story for now — one
 * schema version. Pass ':memory:' or a temp path in tests.
 */
export function initDb(dbPath = DB_PATH) {
  if (dbPath !== ':memory:') {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

/**
 * Persist one completed run and everything under it, in a single transaction.
 * Returns the new run id. Every value written comes straight from the report
 * or the recorder — nothing is estimated here.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{config: object, runInfo: object, caseText: string, report: object,
 *          recorder: {records: Array<object>}, startedAt: string,
 *          wallClockMs: number}} run
 * @returns {number} the new runs.id
 */
export function saveRun(db, { runInfo, caseText, report, recorder, startedAt, wallClockMs }) {
  const stopped = report.representatives.stopped || report.judges.stopped;
  const stoppedReason = report.representatives.stopReason ?? report.judges.stopReason ?? null;
  const completedAt = new Date(Date.parse(startedAt) + wallClockMs).toISOString();

  db.exec('BEGIN');
  try {
    const runInsert = db.prepare(
      `INSERT INTO runs
         (charge_sheet, mode, model_source, started_at, completed_at,
          total_cost, total_tokens, stopped, stopped_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const runId = Number(
      runInsert.run(
        caseText,
        runInfo.mode,
        runInfo.modelSource,
        startedAt,
        completedAt,
        report.totals.costUsd,
        report.totals.totalTokens,
        stopped ? 1 : 0,
        stoppedReason,
      ).lastInsertRowid,
    );

    const verdictInsert = db.prepare(
      'INSERT INTO verdicts (run_id, judge_id, verdict, reasoning) VALUES (?, ?, ?, ?)',
    );
    for (const v of report.verdicts) {
      verdictInsert.run(runId, v.judge_id, v.verdict, v.reasoning);
    }

    const speechInsert = db.prepare(
      'INSERT INTO speeches (run_id, agent_id, seat, speech) VALUES (?, ?, ?, ?)',
    );
    for (const s of report.speeches) {
      speechInsert.run(runId, s.agentId, s.seat, s.speech);
    }

    const callInsert = db.prepare(
      `INSERT INTO calls
         (run_id, agent_id, model_id, prompt_tokens, completion_tokens, cost,
          duration_ms, attempt, validation_outcome, error_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const c of recorder.records) {
      callInsert.run(
        runId,
        c.agentId,
        c.modelId,
        c.promptTokens,
        c.completionTokens,
        c.cost,
        c.durationMs,
        c.attempt,
        c.validation,
        c.error ?? null,
      );
    }

    db.exec('COMMIT');
    return runId;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * All runs, newest first, with a one-line verdict summary for the list view.
 * @returns {Array<{id, started_at, mode, model_source, total_cost, verdict_summary}>}
 */
export function listRuns(db) {
  const runs = db
    .prepare(
      `SELECT id, started_at, mode, model_source, total_cost, stopped, stopped_reason
       FROM runs ORDER BY id DESC`,
    )
    .all();

  const grouped = db
    .prepare('SELECT run_id, verdict, COUNT(*) AS n FROM verdicts GROUP BY run_id, verdict')
    .all();
  const byRun = new Map();
  for (const g of grouped) {
    if (!byRun.has(g.run_id)) byRun.set(g.run_id, []);
    byRun.get(g.run_id).push([g.verdict, g.n]);
  }

  return runs.map((r) => ({
    id: r.id,
    started_at: r.started_at,
    mode: r.mode,
    model_source: r.model_source,
    total_cost: r.total_cost,
    stopped: !!r.stopped,
    stopped_reason: r.stopped_reason,
    verdict_summary: summariseVerdicts(byRun.get(r.id) ?? []),
  }));
}

function summariseVerdicts(pairs) {
  const total = pairs.reduce((a, [, n]) => a + n, 0);
  if (total === 0) return 'no verdict returned';
  const parts = pairs
    .sort((a, b) => b[1] - a[1])
    .map(([verdict, n]) => `${verdict} ×${n}`);
  return total < 3 ? `${parts.join(', ')} (${total} of 3 judges)` : parts.join(', ');
}

/**
 * One run in full, shaped exactly like the live POST /run response so the page
 * renders it with the same code. null if the id is not in the database.
 */
export function getRun(db, id) {
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
  if (!run) return null;

  const verdicts = db
    .prepare('SELECT judge_id, verdict, reasoning FROM verdicts WHERE run_id = ? ORDER BY id')
    .all(id);
  const speeches = db
    .prepare('SELECT agent_id, seat, speech FROM speeches WHERE run_id = ? ORDER BY id')
    .all(id);
  const calls = db
    .prepare('SELECT * FROM calls WHERE run_id = ? ORDER BY id')
    .all(id);

  const speechByAgent = new Map(speeches.map((s) => [s.agent_id, s]));
  const calledAgents = new Set(calls.map((c) => c.agent_id));
  const verdictJudges = new Set(verdicts.map((v) => v.judge_id));

  const repStatus = (agentId) =>
    speechByAgent.has(agentId) ? 'ok' : calledAgents.has(agentId) ? 'failed' : 'not attempted';

  const judgeIds = JUDGES.map((j) => j.id);
  const sum = (key) => calls.reduce((a, c) => a + (typeof c[key] === 'number' ? c[key] : 0), 0);
  const promptTokens = sum('prompt_tokens');
  const completionTokens = sum('completion_tokens');

  return {
    ok: true,
    id: run.id,
    runId: run.id,
    mode: run.mode,
    modelSource: run.model_source,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    representatives: REPRESENTATIVES.map((r) => ({
      agentId: r.id,
      seat: r.seat,
      status: repStatus(r.id),
      speech: speechByAgent.get(r.id)?.speech ?? null,
    })),
    verdicts: verdicts.map((v) => ({
      judge_id: v.judge_id,
      verdict: v.verdict,
      reasoning: v.reasoning,
    })),
    judges: {
      completed: judgeIds.filter((jid) => verdictJudges.has(jid)),
      failed: judgeIds.filter((jid) => calledAgents.has(jid) && !verdictJudges.has(jid)),
      notAttempted: judgeIds.filter((jid) => !calledAgents.has(jid)),
    },
    // Recomputed from the call log — the sum of the records, as spec.md §7.6
    // expects. The runs row's total_cost / total_tokens are the same numbers,
    // denormalised for the list view.
    totals: {
      calls: calls.length,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      costUsd: sum('cost'),
      durationMs: sum('duration_ms'),
      callsWithUnknownCost: calls.filter((c) => c.cost === null).length,
    },
    wallClockMs: Date.parse(run.completed_at) - Date.parse(run.started_at),
    stopped: !!run.stopped,
    stopReason: run.stopped_reason,
  };
}
