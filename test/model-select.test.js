import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_CONTEXT_TOKENS,
  REPRESENTATIVE_MIN_CONTEXT_TOKENS,
  buildModelMap,
  selectCheapestModel,
} from '../src/model-select.js';

function model(id, { prompt = '0', completion = '0', context_length = 32000 } = {}) {
  return { id, pricing: { prompt, completion }, context_length };
}

const SEVEN_AGENTS = [
  { id: 'jon_snow', role: 'representative' },
  { id: 'tyrion_lannister', role: 'representative' },
  { id: 'daenerys_targaryen', role: 'representative' },
  { id: 'grey_worm', role: 'representative' },
  { id: 'barak', role: 'judge' },
  { id: 'elon', role: 'judge' },
  { id: 'shamgar', role: 'judge' },
];

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

// --- Mode B mapping (buildModelMap) ---

test('buildModelMap: 7 agents get 7 distinct models, cheapest first in agent order', () => {
  const models = Array.from({ length: 10 }, (_, i) =>
    model(`v/m${i}`, { prompt: `0.000000${i}`, completion: '0', context_length: 32000 }),
  );
  const result = buildModelMap(models, SEVEN_AGENTS);
  assert.equal(result.ok, true);
  const ids = SEVEN_AGENTS.map((a) => result.map[a.id].id);
  assert.deepEqual(ids, ['v/m0', 'v/m1', 'v/m2', 'v/m3', 'v/m4', 'v/m5', 'v/m6']);
  assert.equal(new Set(ids).size, 7);
});

test('buildModelMap: a model is never shared between two agents', () => {
  // Two qualifying models, three agents: the third has nothing left.
  const models = [
    model('big/1', { context_length: 32000 }),
    model('big/2', { context_length: 32000 }),
    model('small/1', { context_length: 8000 }),
  ];
  const result = buildModelMap(models, [
    { id: 'rep', role: 'representative' },
    { id: 'judge_a', role: 'judge' },
    { id: 'judge_b', role: 'judge' },
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.agentId, 'judge_b');
  assert.match(result.reason, /judge_b/);
});

test('buildModelMap: includeZeroPrice:false skips advertised-$0 models', () => {
  const models = [
    model('free/a', { context_length: 32000 }),
    model('free/b', { context_length: 32000 }),
    model('paid/a', { prompt: '0.000001', completion: '0', context_length: 32000 }),
    model('paid/b', { prompt: '0.000002', completion: '0', context_length: 32000 }),
  ];
  const agents = [
    { id: 'r1', role: 'representative' },
    { id: 'r2', role: 'representative' },
  ];

  const withFree = buildModelMap(models, agents);
  assert.deepEqual([withFree.map.r1.id, withFree.map.r2.id], ['free/a', 'free/b']);

  const noFree = buildModelMap(models, agents, { includeZeroPrice: false });
  assert.deepEqual([noFree.map.r1.id, noFree.map.r2.id], ['paid/a', 'paid/b']);
});

test('buildModelMap: a mid-size model serves a representative but not a judge', () => {
  const models = [model('mid/1', { context_length: REPRESENTATIVE_MIN_CONTEXT_TOKENS + 100 })];
  assert.equal(buildModelMap(models, [{ id: 'r', role: 'representative' }]).ok, true);

  const forJudge = buildModelMap(models, [{ id: 'j', role: 'judge' }]);
  assert.equal(forJudge.ok, false);
  assert.equal(forJudge.agentId, 'j');
  assert.match(forJudge.reason, new RegExp(String(MIN_CONTEXT_TOKENS)));
});

test('buildModelMap: never assigns a model id absent from the input list', () => {
  const models = [
    model('only/a', { context_length: 32000 }),
    model('only/b', { context_length: 32000 }),
  ];
  const ids = new Set(models.map((m) => m.id));
  const result = buildModelMap(models, [
    { id: 'r1', role: 'representative' },
    { id: 'r2', role: 'representative' },
  ]);
  assert.equal(result.ok, true);
  for (const a of ['r1', 'r2']) assert.ok(ids.has(result.map[a].id));
});

test('buildModelMap: non-array inputs are handled failures, not throws', () => {
  assert.equal(buildModelMap(null, []).ok, false);
  assert.equal(buildModelMap([], null).ok, false);
});
