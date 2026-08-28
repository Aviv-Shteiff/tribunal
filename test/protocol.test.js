import test from 'node:test';
import assert from 'node:assert/strict';

import { ProtocolRecorder } from '../src/protocol.js';

const FIELDS = [
  'agentId',
  'modelId',
  'promptTokens',
  'completionTokens',
  'cost',
  'durationMs',
  'timestamp',
  'attempt',
  'validation',
  'error',
];

test('a record carries every field spec.md §6 requires', () => {
  const recorder = new ProtocolRecorder();
  const record = recorder.append({
    agentId: 'barak',
    modelId: 'fake/model-under-test',
    promptTokens: 100,
    completionTokens: 50,
    cost: 0.002,
    durationMs: 1234,
    attempt: 1,
    validation: 'valid',
  });

  assert.deepEqual(Object.keys(record).sort(), [...FIELDS].sort());
  assert.equal(record.attempt, 1);
  assert.equal(record.validation, 'valid');
  assert.ok(!Number.isNaN(Date.parse(record.timestamp)));
});

test('totals are the sum of the records', () => {
  const recorder = new ProtocolRecorder();
  recorder.append({
    agentId: 'a', modelId: 'm', promptTokens: 100, completionTokens: 50,
    cost: 0.002, durationMs: 1000, attempt: 1, validation: 'valid',
  });
  recorder.append({
    agentId: 'b', modelId: 'm', promptTokens: 200, completionTokens: 25,
    cost: 0.003, durationMs: 1500, attempt: 1, validation: 'valid',
  });

  const totals = recorder.totals();
  assert.equal(totals.calls, 2);
  assert.equal(totals.promptTokens, 300);
  assert.equal(totals.completionTokens, 75);
  assert.equal(totals.totalTokens, 375);
  assert.ok(Math.abs(totals.costUsd - 0.005) < 1e-12);
  assert.equal(totals.durationMs, 2500);
  assert.equal(totals.callsWithUnknownCost, 0);
});

test('a failed call is still one record, and contributes no invented numbers', () => {
  const recorder = new ProtocolRecorder();
  recorder.append({
    agentId: 'a', modelId: 'm', durationMs: 300, attempt: 1,
    validation: 'call_failed', error: 'model call failed: socket hang up',
  });

  const [record] = recorder.records;
  assert.equal(record.promptTokens, null);
  assert.equal(record.completionTokens, null);
  assert.equal(record.cost, null);

  const totals = recorder.totals();
  assert.equal(totals.calls, 1);
  assert.equal(totals.costUsd, 0);
  assert.equal(totals.totalTokens, 0);
  assert.equal(totals.callsWithUnknownCost, 1);
});

test('records are frozen and the list is a copy', () => {
  const recorder = new ProtocolRecorder();
  recorder.append({ agentId: 'a', modelId: 'm', durationMs: 1, attempt: 1, validation: 'valid' });

  assert.throws(() => {
    recorder.records[0].cost = 999;
  });
  recorder.records.push({ bogus: true });
  assert.equal(recorder.records.length, 1);
});
