import test from 'node:test';
import assert from 'node:assert/strict';

import { BudgetGate } from '../src/budget.js';
import { ProtocolRecorder } from '../src/protocol.js';
import { callWithValidation } from '../src/retry.js';
import { validateJudge } from '../src/validate.js';
import { fakeTransport, VALID_JUDGE } from './fake-client.js';

function run(script, { cap = 1 } = {}) {
  const transport = fakeTransport(script);
  const gate = new BudgetGate(cap);
  const recorder = new ProtocolRecorder();
  const promise = callWithValidation({
    agentId: 'barak',
    modelId: 'fake/model-under-test',
    systemPrompt: 'you are a judge',
    userMessage: 'the charge sheet',
    validate: validateJudge,
    gate,
    recorder,
    transport,
  });
  return { promise, transport, gate, recorder };
}

test('a valid first response needs no retry', async () => {
  const { promise, transport, recorder } = run([{ content: VALID_JUDGE }]);
  const result = await promise;

  assert.equal(result.status, 'ok');
  assert.equal(result.attempts, 1);
  assert.equal(result.value.verdict, 'not justified');
  assert.equal(transport.calls.length, 1);
  assert.equal(recorder.records.length, 1);
  assert.equal(recorder.records[0].validation, 'valid');
});

test('a retry that succeeds: two calls, two records, attempts numbered', async () => {
  const { promise, transport, recorder } = run([
    { content: 'Here is my ruling: the act was justified.' },
    { content: VALID_JUDGE },
  ]);
  const result = await promise;

  assert.equal(result.status, 'ok');
  assert.equal(result.attempts, 2);
  assert.equal(transport.calls.length, 2);

  assert.deepEqual(
    recorder.records.map((r) => [r.attempt, r.validation]),
    [[1, 'invalid'], [2, 'valid']],
  );
  assert.match(recorder.records[0].error, /not valid JSON/);
  assert.equal(recorder.records[1].error, null);
});

test('the retry carries a corrective instruction naming the failure', async () => {
  const { promise, transport } = run([
    { content: JSON.stringify({ judge_id: 'barak', verdict: 'maybe', reasoning: 'r', key_factors: [] }) },
    { content: VALID_JUDGE },
  ]);
  await promise;

  const retryMessage = transport.calls[1].messages[1].content;
  assert.match(retryMessage, /the charge sheet/, 'the original message is preserved');
  assert.match(retryMessage, /previous response was rejected/);
  assert.match(retryMessage, /"verdict"/);
});

test('a retry that fails returns a failed result and does not throw', async () => {
  const { promise, transport, recorder } = run([
    { content: 'not json' },
    { content: 'still not json' },
  ]);
  const result = await promise;

  assert.equal(result.status, 'failed');
  assert.equal(result.agentId, 'barak');
  assert.equal(result.attempts, 2);
  assert.match(result.error, /validation failed after 2 attempts/);
  assert.equal(transport.calls.length, 2, 'exactly one corrective retry, no third attempt');
  assert.deepEqual(recorder.records.map((r) => r.validation), ['invalid', 'invalid']);
});

test('an empty response is a handled failure and earns the one retry', async () => {
  const { promise, transport, recorder } = run([{ content: '' }, { content: VALID_JUDGE }]);
  const result = await promise;

  assert.equal(result.status, 'ok');
  assert.equal(transport.calls.length, 2);
  assert.match(recorder.records[0].error, /empty/);
});

test('a third verdict value is rejected even on the retry', async () => {
  const third = JSON.stringify({
    judge_id: 'barak',
    verdict: 'justifiable homicide',
    reasoning: 'A third way.',
    key_factors: ['none'],
  });
  const { promise } = run([{ content: third }, { content: third }]);
  const result = await promise;

  assert.equal(result.status, 'failed');
  assert.match(result.error, /"verdict"/);
});

test('both attempts are charged to the budget gate', async () => {
  const { promise, gate } = run([
    { content: 'not json', cost: 0.002 },
    { content: VALID_JUDGE, cost: 0.003 },
  ]);
  await promise;
  assert.ok(Math.abs(gate.spentUsd - 0.005) < 1e-12);
});

test('a transport failure is recorded and not retried', async () => {
  const { promise, transport, recorder } = run([
    { throws: 'ETIMEDOUT' },
    { content: VALID_JUDGE },
  ]);
  const result = await promise;

  assert.equal(result.status, 'failed');
  assert.equal(result.attempts, 1);
  assert.match(result.error, /ETIMEDOUT/);
  assert.equal(transport.calls.length, 1, 'the retry is for validation failure only');
  assert.equal(recorder.records.length, 1);
  assert.equal(recorder.records[0].validation, 'call_failed');
  assert.equal(recorder.records[0].cost, null);
});

test('the gate is consulted before the retry, not only before the first call', async () => {
  // Cap 0.01: the first call costs 0.006, so spent + reserve = 0.012 >= cap.
  const { promise, transport, recorder } = run(
    [{ content: 'not json', cost: 0.006 }, { content: VALID_JUDGE }],
    { cap: 0.01 },
  );
  const result = await promise;

  assert.equal(result.status, 'budget_stopped');
  assert.equal(result.attempts, 1);
  assert.match(result.reason, /budget cap reached/);
  assert.equal(transport.calls.length, 1, 'the retry call was never made');
  assert.equal(recorder.records.length, 1);
});
