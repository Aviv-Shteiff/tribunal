import test from 'node:test';
import assert from 'node:assert/strict';

import { getRun, initDb, listRuns, saveRun } from '../scripts/db.js';
import { JUDGES, REPRESENTATIVES } from '../src/personas.js';

// A full, clean synthetic run: 4 speeches, 3 verdicts, 7 calls.
function fullRun({ startedAt = '2026-08-30T10:00:00.000Z', wallClockMs = 65_000 } = {}) {
  const speeches = REPRESENTATIVES.map((r) => ({
    agentId: r.id,
    seat: r.seat,
    speech: `${r.id} argues the point.`,
  }));
  const verdicts = JUDGES.map((j, i) => ({
    judge_id: j.id,
    verdict: i === 1 ? 'justified' : 'not justified',
    reasoning: `${j.id} reasons at length.`,
  }));
  const records = [
    ...REPRESENTATIVES.map((r) => ({
      agentId: r.id, modelId: 'vendor/rep-model',
      promptTokens: 1000, completionTokens: 400, cost: 0.0001,
      durationMs: 5000, attempt: 1, validation: 'valid', error: null,
    })),
    ...JUDGES.map((j) => ({
      agentId: j.id, modelId: 'vendor/judge-model',
      promptTokens: 2200, completionTokens: 700, cost: 0.0002,
      durationMs: 8000, attempt: 1, validation: 'valid', error: null,
    })),
  ];
  const totalTokens = records.reduce((a, c) => a + c.promptTokens + c.completionTokens, 0);
  const costUsd = records.reduce((a, c) => a + c.cost, 0);

  return {
    runInfo: { mode: 'A', modelSource: 'DEMO_MODEL_ID' },
    caseText: 'Was the killing justified?',
    startedAt,
    wallClockMs,
    report: {
      speeches,
      verdicts,
      representatives: { stopped: false, stopReason: null },
      judges: { stopped: false, stopReason: null },
      totals: { totalTokens, costUsd },
    },
    recorder: { records },
  };
}

test('initDb creates the four tables', () => {
  const db = initDb(':memory:');
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);
  assert.deepEqual(names, ['calls', 'runs', 'speeches', 'verdicts']);
  db.close();
});

test('saveRun writes one row per table and the round trip matches', () => {
  const db = initDb(':memory:');
  const run = fullRun();
  const id = saveRun(db, run);
  assert.equal(typeof id, 'number');

  const runRow = db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
  assert.equal(runRow.charge_sheet, run.caseText);
  assert.equal(runRow.mode, 'A');
  assert.equal(runRow.model_source, 'DEMO_MODEL_ID');
  assert.equal(runRow.started_at, run.startedAt);
  assert.equal(runRow.completed_at, '2026-08-30T10:01:05.000Z'); // started + 65s
  assert.equal(runRow.stopped, 0);
  assert.equal(runRow.stopped_reason, null);
  assert.ok(Math.abs(runRow.total_cost - run.report.totals.costUsd) < 1e-12);
  assert.equal(runRow.total_tokens, run.report.totals.totalTokens);

  const verdicts = db.prepare('SELECT * FROM verdicts WHERE run_id = ? ORDER BY id').all(id);
  assert.equal(verdicts.length, 3);
  assert.deepEqual(verdicts.map((v) => v.judge_id), JUDGES.map((j) => j.id));
  assert.equal(verdicts[1].verdict, 'justified');

  const speeches = db.prepare('SELECT * FROM speeches WHERE run_id = ? ORDER BY id').all(id);
  assert.equal(speeches.length, 4);
  assert.deepEqual(speeches.map((s) => s.agent_id), REPRESENTATIVES.map((r) => r.id));
  assert.equal(speeches[0].seat, REPRESENTATIVES[0].seat);

  const calls = db.prepare('SELECT * FROM calls WHERE run_id = ? ORDER BY id').all(id);
  assert.equal(calls.length, 7);
  assert.equal(calls[0].validation_outcome, 'valid');
  assert.equal(calls[0].error_text, null);
  assert.equal(calls[0].attempt, 1);
  db.close();
});

test('calls store nulls and the error text for a failed call', () => {
  const db = initDb(':memory:');
  const run = fullRun();
  run.report.speeches = run.report.speeches.filter((s) => s.agentId !== 'tyrion_lannister');
  run.recorder.records = [
    ...run.recorder.records.filter((r) => r.agentId !== 'tyrion_lannister'),
    {
      agentId: 'tyrion_lannister', modelId: 'vendor/rep-model',
      promptTokens: null, completionTokens: null, cost: null,
      durationMs: 1200, attempt: 2, validation: 'call_failed',
      error: 'model call failed: HTTP 429 Too Many Requests',
    },
  ];
  const id = saveRun(db, run);

  const failed = db
    .prepare("SELECT * FROM calls WHERE run_id = ? AND agent_id = 'tyrion_lannister'")
    .get(id);
  assert.equal(failed.prompt_tokens, null);
  assert.equal(failed.cost, null);
  assert.equal(failed.validation_outcome, 'call_failed');
  assert.match(failed.error_text, /HTTP 429/);
  db.close();
});

test('listRuns returns newest first with a verdict summary', () => {
  const db = initDb(':memory:');
  saveRun(db, fullRun({ startedAt: '2026-08-30T09:00:00.000Z' }));
  const second = fullRun({ startedAt: '2026-08-30T12:00:00.000Z' });
  second.runInfo.mode = 'B';
  saveRun(db, second);

  const runs = listRuns(db);
  assert.equal(runs.length, 2);
  assert.ok(runs[0].id > runs[1].id); // newest first
  assert.equal(runs[0].mode, 'B');
  assert.equal(runs[0].verdict_summary, 'not justified ×2, justified ×1');
  db.close();
});

test('listRuns summarises a run with a failed judge as fewer than three', () => {
  const db = initDb(':memory:');
  const run = fullRun();
  run.report.verdicts = run.report.verdicts.filter((v) => v.judge_id !== 'shamgar');
  const id = saveRun(db, run);
  const summary = listRuns(db).find((r) => r.id === id).verdict_summary;
  assert.match(summary, /2 of 3 judges/);
  db.close();
});

test('getRun rebuilds the POST /run shape from the stored rows', () => {
  const db = initDb(':memory:');
  const id = saveRun(db, fullRun());
  const d = getRun(db, id);

  assert.equal(d.ok, true);
  assert.equal(d.runId, id);
  assert.equal(d.mode, 'A');
  assert.equal(d.modelSource, 'DEMO_MODEL_ID');
  assert.equal(d.wallClockMs, 65_000);

  assert.deepEqual(d.representatives.map((r) => r.agentId), REPRESENTATIVES.map((r) => r.id));
  assert.ok(d.representatives.every((r) => r.status === 'ok' && typeof r.speech === 'string'));

  assert.equal(d.verdicts.length, 3);
  assert.deepEqual(d.judges.completed, JUDGES.map((j) => j.id));
  assert.deepEqual(d.judges.failed, []);
  assert.deepEqual(d.judges.notAttempted, []);

  assert.equal(d.totals.calls, 7);
  assert.equal(d.totals.callsWithUnknownCost, 0);
  assert.equal(d.totals.totalTokens, d.totals.promptTokens + d.totals.completionTokens);
  assert.ok(Math.abs(d.totals.costUsd - fullRun().report.totals.costUsd) < 1e-12);
  assert.equal(d.stopped, false);
  db.close();
});

test('getRun marks a called-but-verdictless judge as failed, an uncalled one as not attempted', () => {
  const db = initDb(':memory:');
  const run = fullRun();
  // shamgar was called but produced nothing; elon was never reached.
  run.report.verdicts = run.report.verdicts.filter((v) => v.judge_id === 'barak');
  run.recorder.records = run.recorder.records.filter((r) => r.agentId !== 'elon');
  run.recorder.records.push({
    agentId: 'shamgar', modelId: 'vendor/judge-model',
    promptTokens: 2200, completionTokens: 50, cost: 0.0001,
    durationMs: 4000, attempt: 2, validation: 'invalid', error: 'not valid JSON',
  });
  const id = saveRun(db, run);
  const d = getRun(db, id);

  assert.deepEqual(d.judges.completed, ['barak']);
  assert.deepEqual(d.judges.failed, ['shamgar']);
  assert.deepEqual(d.judges.notAttempted, ['elon']);
  db.close();
});

test('getRun returns null for an unknown id', () => {
  const db = initDb(':memory:');
  assert.equal(getRun(db, 999), null);
  db.close();
});

test('a stopped run round-trips its flag and reason', () => {
  const db = initDb(':memory:');
  const run = fullRun();
  run.report.judges = { stopped: true, stopReason: 'budget cap reached: $0.49 spent, cap is $0.50' };
  const id = saveRun(db, run);

  const row = db.prepare('SELECT stopped, stopped_reason FROM runs WHERE id = ?').get(id);
  assert.equal(row.stopped, 1);
  assert.match(row.stopped_reason, /budget cap reached/);
  assert.equal(getRun(db, id).stopped, true);
  db.close();
});
