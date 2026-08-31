// The run store (spec.md §6: "every completed run is persisted and listable").
// libSQL via @libsql/client — a Turso database in a deploy (free tier, no card),
// a local libSQL file otherwise. Same SQLite engine and schema as before; the
// client has no synchronous API, so initDb / saveRun / listRuns / getRun are
// async. Supersedes D-014's node:sqlite choice for the deployed environment —
// see D-017. This is the project's first runtime dependency.
//
// Four tables: runs, verdicts, speeches, calls. verdicts and speeches each hold
// one row per agent that produced a valid output; calls is the log of every
// model call the lecture requires — one row per call, in call order.
//
// This module only stores and reads back. It does not call models, resolve
// models, validate, or retry.

import { createClient } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { JUDGES, REPRESENTATIVES } from '../src/personas.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The local libSQL file used when TURSO_DATABASE_URL is not set. DB_PATH
// overrides the path; it is a local-dev convenience only — a deploy uses the
// Turso URL, not this.
export const LOCAL_DB_PATH = process.env.DB_PATH || path.join(HERE, '..', 'db', 'tribunal.db');

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS runs (
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
   )`,
  `CREATE TABLE IF NOT EXISTS verdicts (
     id        INTEGER PRIMARY KEY,
     run_id    INTEGER NOT NULL REFERENCES runs(id),
     judge_id  TEXT    NOT NULL,
     verdict   TEXT    NOT NULL,
     reasoning TEXT    NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS speeches (
     id       INTEGER PRIMARY KEY,
     run_id   INTEGER NOT NULL REFERENCES runs(id),
     agent_id TEXT    NOT NULL,
     seat     TEXT    NOT NULL,
     speech   TEXT    NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS calls (
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
   )`,
];

// Turn a target into a createClient() config plus, when it is a local file, the
// path whose parent directory must exist. `target` may be:
//   - undefined  -> Turso from the environment, else the local file
//   - a libsql:/file:/http(s):/ws(s): URL  -> used as-is
//   - a bare filesystem path               -> a local file
const URL_LIKE = /^(file:|libsql:|https?:|wss?:)/i;

function clientConfig(target) {
  if (target == null) {
    if (process.env.TURSO_DATABASE_URL) {
      return {
        config: { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN },
        localFile: null,
      };
    }
    return { config: { url: `file:${LOCAL_DB_PATH}` }, localFile: LOCAL_DB_PATH };
  }
  if (URL_LIKE.test(target)) {
    return {
      config: { url: target },
      localFile: target.startsWith('file:') ? target.slice('file:'.length) : null,
    };
  }
  return { config: { url: `file:${target}` }, localFile: target };
}

/**
 * Open the store and ensure the schema. Async: the libSQL client has no
 * synchronous API. `CREATE TABLE IF NOT EXISTS` is the whole migration story
 * for now — one schema version. Tests pass an explicit local file path.
 *
 * @param {string} [target]
 * @returns {Promise<import('@libsql/client').Client>}
 */
export async function initDb(target) {
  const { config, localFile } = clientConfig(target);
  if (localFile) {
    mkdirSync(path.dirname(path.resolve(localFile)), { recursive: true });
  }
  const db = createClient(config);
  await db.execute('PRAGMA foreign_keys = ON');
  for (const stmt of SCHEMA_STATEMENTS) {
    await db.execute(stmt);
  }
  return db;
}

/**
 * Persist one completed run and everything under it, in a single transaction.
 * Returns the new run id. Every value written comes straight from the report
 * or the recorder — nothing is estimated here.
 *
 * @param {import('@libsql/client').Client} db
 * @param {{runInfo: object, caseText: string, report: object,
 *          recorder: {records: Array<object>}, startedAt: string,
 *          wallClockMs: number}} run
 * @returns {Promise<number>} the new runs.id
 */
export async function saveRun(db, { runInfo, caseText, report, recorder, startedAt, wallClockMs }) {
  const stopped = report.representatives.stopped || report.judges.stopped;
  const stoppedReason = report.representatives.stopReason ?? report.judges.stopReason ?? null;
  const completedAt = new Date(Date.parse(startedAt) + wallClockMs).toISOString();

  const tx = await db.transaction('write');
  try {
    const runRes = await tx.execute({
      sql: `INSERT INTO runs
              (charge_sheet, mode, model_source, started_at, completed_at,
               total_cost, total_tokens, stopped, stopped_reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id`,
      args: [
        caseText,
        runInfo.mode,
        runInfo.modelSource,
        startedAt,
        completedAt,
        report.totals.costUsd,
        report.totals.totalTokens,
        stopped ? 1 : 0,
        stoppedReason,
      ],
    });
    const runId = Number(runRes.rows[0].id);

    for (const v of report.verdicts) {
      await tx.execute({
        sql: 'INSERT INTO verdicts (run_id, judge_id, verdict, reasoning) VALUES (?, ?, ?, ?)',
        args: [runId, v.judge_id, v.verdict, v.reasoning],
      });
    }

    for (const s of report.speeches) {
      await tx.execute({
        sql: 'INSERT INTO speeches (run_id, agent_id, seat, speech) VALUES (?, ?, ?, ?)',
        args: [runId, s.agentId, s.seat, s.speech],
      });
    }

    for (const c of recorder.records) {
      await tx.execute({
        sql: `INSERT INTO calls
                (run_id, agent_id, model_id, prompt_tokens, completion_tokens, cost,
                 duration_ms, attempt, validation_outcome, error_text)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          runId,
          c.agentId,
          c.modelId,
          c.promptTokens ?? null,
          c.completionTokens ?? null,
          c.cost ?? null,
          c.durationMs,
          c.attempt,
          c.validation,
          c.error ?? null,
        ],
      });
    }

    await tx.commit();
    return runId;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

/**
 * All runs, newest first, with a one-line verdict summary for the list view.
 * @returns {Promise<Array<{id, started_at, mode, model_source, total_cost,
 *                          stopped, stopped_reason, verdict_summary}>>}
 */
export async function listRuns(db) {
  const runs = (
    await db.execute(
      `SELECT id, started_at, mode, model_source, total_cost, stopped, stopped_reason
       FROM runs ORDER BY id DESC`,
    )
  ).rows;

  const grouped = (
    await db.execute('SELECT run_id, verdict, COUNT(*) AS n FROM verdicts GROUP BY run_id, verdict')
  ).rows;
  const byRun = new Map();
  for (const g of grouped) {
    const key = String(g.run_id);
    if (!byRun.has(key)) byRun.set(key, []);
    byRun.get(key).push([g.verdict, Number(g.n)]);
  }

  return runs.map((r) => ({
    id: Number(r.id),
    started_at: r.started_at,
    mode: r.mode,
    model_source: r.model_source,
    total_cost: r.total_cost,
    stopped: !!r.stopped,
    stopped_reason: r.stopped_reason,
    verdict_summary: summariseVerdicts(byRun.get(String(r.id)) ?? []),
  }));
}

function summariseVerdicts(pairs) {
  const total = pairs.reduce((a, [, n]) => a + n, 0);
  if (total === 0) return 'no verdict returned';
  const parts = pairs.sort((a, b) => b[1] - a[1]).map(([verdict, n]) => `${verdict} ×${n}`);
  return total < 3 ? `${parts.join(', ')} (${total} of 3 judges)` : parts.join(', ');
}

/**
 * One run in full, shaped exactly like the live POST /run response so the page
 * renders it with the same code. null if the id is not in the database.
 * @returns {Promise<object|null>}
 */
export async function getRun(db, id) {
  const run = (await db.execute({ sql: 'SELECT * FROM runs WHERE id = ?', args: [id] })).rows[0];
  if (!run) return null;

  const verdicts = (
    await db.execute({
      sql: 'SELECT judge_id, verdict, reasoning FROM verdicts WHERE run_id = ? ORDER BY id',
      args: [id],
    })
  ).rows;
  const speeches = (
    await db.execute({
      sql: 'SELECT agent_id, seat, speech FROM speeches WHERE run_id = ? ORDER BY id',
      args: [id],
    })
  ).rows;
  const calls = (
    await db.execute({ sql: 'SELECT * FROM calls WHERE run_id = ? ORDER BY id', args: [id] })
  ).rows;

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
    id: Number(run.id),
    runId: Number(run.id),
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
