import test from 'node:test';
import assert from 'node:assert/strict';

import { BudgetGate } from '../src/budget.js';
import { ProtocolRecorder } from '../src/protocol.js';
import { executeCalls } from '../src/run-harness.js';
import { validateJudge } from '../src/validate.js';
import { fakeTransport, VALID_JUDGE } from './fake-client.js';

function requests(...agentIds) {
  return agentIds.map((agentId) => ({
    agentId,
    modelId: 'fake/model-under-test',
    systemPrompt: `you are ${agentId}`,
    userMessage: 'the charge sheet',
    validate: validateJudge,
  }));
}

test('a run within budget completes every agent, one record per call', async () => {
  const transport = fakeTransport([
    { content: VALID_JUDGE, cost: 0.001 },
    { content: VALID_JUDGE, cost: 0.001 },
    { content: VALID_JUDGE, cost: 0.001 },
  ]);
  const recorder = new ProtocolRecorder();

  const report = await executeCalls(requests('barak', 'cheshin', 'dorner'), {
    gate: new BudgetGate(1),
    recorder,
    transport,
  });

  assert.equal(report.stopped, false);
  assert.equal(report.stopReason, null);
  assert.deepEqual(report.completedAgents, ['barak', 'cheshin', 'dorner']);
  assert.deepEqual(report.notAttemptedAgents, []);
  assert.equal(report.totals.calls, 3);
  assert.equal(recorder.records.length, 3);
  assert.ok(Math.abs(report.totals.costUsd - 0.003) < 1e-12);
});

test('the budget stops the run mid-run and reports which agents completed', async () => {
  // Cap 0.015, each call 0.004. Before the fourth: 0.012 spent + 0.004 reserve >= cap.
  const transport = fakeTransport([
    { content: VALID_JUDGE, cost: 0.004 },
    { content: VALID_JUDGE, cost: 0.004 },
    { content: VALID_JUDGE, cost: 0.004 },
    { content: VALID_JUDGE, cost: 0.004 },
  ]);
  const recorder = new ProtocolRecorder();

  const report = await executeCalls(requests('jon_snow', 'tyrion', 'daenerys', 'grey_worm'), {
    gate: new BudgetGate(0.015),
    recorder,
    transport,
  });

  assert.equal(report.stopped, true);
  assert.match(report.stopReason, /budget cap reached/);
  assert.deepEqual(report.completedAgents, ['jon_snow', 'tyrion', 'daenerys']);
  assert.deepEqual(report.notAttemptedAgents, ['grey_worm']);
  assert.equal(transport.calls.length, 3, 'the fourth call was never made');
  assert.equal(report.totals.calls, 3);
  assert.ok(Math.abs(report.totals.costUsd - 0.012) < 1e-12);
});

test('the run is not silently shortened when one agent fails validation twice', async () => {
  const transport = fakeTransport([
    { content: VALID_JUDGE, cost: 0.001 },
    { content: 'not json', cost: 0.001 },
    { content: 'still not json', cost: 0.001 },
    { content: VALID_JUDGE, cost: 0.001 },
  ]);
  const recorder = new ProtocolRecorder();

  const report = await executeCalls(requests('barak', 'cheshin', 'dorner'), {
    gate: new BudgetGate(1),
    recorder,
    transport,
  });

  assert.equal(report.stopped, false);
  assert.deepEqual(report.completedAgents, ['barak', 'dorner']);
  assert.deepEqual(report.failedAgents, ['cheshin']);
  assert.equal(report.results.length, 3, 'the failed agent still appears in the run');
  assert.equal(report.totals.calls, 4, 'its two attempts are both in the protocol');
});

test('a zero cap stops the run before any call is made', async () => {
  const transport = fakeTransport([]);
  const report = await executeCalls(requests('barak'), {
    gate: new BudgetGate(0),
    recorder: new ProtocolRecorder(),
    transport,
  });

  assert.equal(report.stopped, true);
  assert.deepEqual(report.completedAgents, []);
  assert.deepEqual(report.notAttemptedAgents, ['barak']);
  assert.equal(transport.calls.length, 0);
  assert.equal(report.totals.calls, 0);
});

test('each agent sees only its own system prompt and the charge sheet', async () => {
  const transport = fakeTransport([
    { content: VALID_JUDGE, cost: 0.001 },
    { content: VALID_JUDGE, cost: 0.001 },
  ]);
  await executeCalls(requests('barak', 'cheshin'), {
    gate: new BudgetGate(1),
    recorder: new ProtocolRecorder(),
    transport,
  });

  for (const body of transport.calls) {
    assert.equal(body.messages.length, 2);
    assert.equal(body.messages[1].content, 'the charge sheet');
  }
  assert.equal(transport.calls[0].messages[0].content, 'you are barak');
  assert.equal(transport.calls[1].messages[0].content, 'you are cheshin');
});
