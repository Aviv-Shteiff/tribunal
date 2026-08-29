import test from 'node:test';
import assert from 'node:assert/strict';

import { MIN_CONTEXT_TOKENS, selectCheapestModel } from '../src/model-select.js';

function model(id, { prompt = '0', completion = '0', context_length = 32000 } = {}) {
  return { id, pricing: { prompt, completion }, context_length };
}

test('picks the zero-price model over any paid model', () => {
  const result = selectCheapestModel([
    model('paid/cheap', { prompt: '0.0000002', completion: '0.0000002' }),
    model('free/one'),
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.model.id, 'free/one');
  assert.equal(result.model.totalPrice, 0);
});

test('among equal price, the larger context wins — capability second', () => {
  const result = selectCheapestModel([
    model('free/small', { context_length: 16000 }),
    model('free/large', { context_length: 131072 }),
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.model.id, 'free/large');
});

test('a model below the context floor is excluded even if free', () => {
  const result = selectCheapestModel([
    model('free/too-small', { context_length: MIN_CONTEXT_TOKENS - 1 }),
    model('paid/big-enough', { prompt: '0.000001', completion: '0.000001', context_length: 32000 }),
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.model.id, 'paid/big-enough');
});

test('no qualifying model returns a reason, not a throw or a bad pick', () => {
  const result = selectCheapestModel([
    model('free/too-small', { context_length: 100 }),
    model('paid/also-too-small', { prompt: '0.001', completion: '0.001', context_length: 500 }),
  ]);
  assert.equal(result.ok, false);
  assert.match(result.reason, /no model/);
});

test('an empty list returns a reason, not a throw', () => {
  const result = selectCheapestModel([]);
  assert.equal(result.ok, false);
});

test('malformed entries are skipped, not fatal', () => {
  const result = selectCheapestModel([
    { id: 'bad/no-pricing', context_length: 32000 },
    { id: 'bad/no-context', pricing: { prompt: '0', completion: '0' } },
    { pricing: { prompt: '0', completion: '0' }, context_length: 32000 }, // no id
    model('good/one'),
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.model.id, 'good/one');
  assert.equal(result.candidates, 1);
});

test('never returns a model id that was not in the input list', () => {
  const input = [model('free/a'), model('free/b', { context_length: 200000 })];
  const result = selectCheapestModel(input);
  assert.ok(input.some((m) => m.id === result.model.id));
});

test('a non-array input is a handled failure', () => {
  const result = selectCheapestModel(null);
  assert.equal(result.ok, false);
});

test('a custom context floor is honored', () => {
  const result = selectCheapestModel(
    [model('free/small', { context_length: 4000 }), model('free/large', { context_length: 32000 })],
    { minContextTokens: 8000 },
  );
  assert.equal(result.ok, true);
  assert.equal(result.model.id, 'free/large');
});
