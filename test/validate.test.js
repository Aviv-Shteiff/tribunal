import test from 'node:test';
import assert from 'node:assert/strict';

import { stripFences, validateJudge, validateRepresentative } from '../src/validate.js';
import { VALID_JUDGE, VALID_REPRESENTATIVE } from './fake-client.js';

test('accepts a well-formed representative response', () => {
  const result = validateRepresentative(VALID_REPRESENTATIVE);
  assert.equal(result.ok, true);
  assert.equal(result.value.agent_id, 'jon_snow');
  assert.equal(result.value.seat, 'defense');
  assert.deepEqual(result.value.key_points, ['imminent threat', 'no alternative']);
});

test('accepts a well-formed judge response', () => {
  const result = validateJudge(VALID_JUDGE);
  assert.equal(result.ok, true);
  assert.equal(result.value.verdict, 'not justified');
});

test('accepts a response wrapped in code fences', () => {
  const fenced = '```json\n' + VALID_JUDGE + '\n```';
  const result = validateJudge(fenced);
  assert.equal(result.ok, true);
  assert.equal(result.value.judge_id, 'barak');
});

test('accepts a bare fence with no language tag and surrounding whitespace', () => {
  const result = validateJudge('\n  ```\n' + VALID_JUDGE + '\n```  \n');
  assert.equal(result.ok, true);
});

test('stripFences leaves an unfenced string alone', () => {
  assert.equal(stripFences('  {"a":1}  '), '{"a":1}');
});

test('rejects malformed JSON', () => {
  const result = validateJudge('{"judge_id": "barak", "verdict": ');
  assert.equal(result.ok, false);
  assert.match(result.error, /not valid JSON/);
});

test('rejects a third verdict value', () => {
  const raw = JSON.stringify({
    judge_id: 'barak',
    verdict: 'justifiable homicide',
    reasoning: 'A third way.',
    key_factors: ['none'],
  });
  const result = validateJudge(raw);
  assert.equal(result.ok, false);
  assert.match(result.error, /"verdict"/);
  assert.match(result.error, /justifiable homicide/);
});

test('rejects a verdict that differs only in case', () => {
  const raw = JSON.stringify({
    judge_id: 'barak',
    verdict: 'Justified',
    reasoning: 'Capitalised.',
    key_factors: ['none'],
  });
  assert.equal(validateJudge(raw).ok, false);
});

test('rejects prose in the verdict field', () => {
  const raw = JSON.stringify({
    judge_id: 'barak',
    verdict: 'I find the act was justified under the circumstances.',
    reasoning: 'Prose where a value belongs.',
    key_factors: ['none'],
  });
  assert.equal(validateJudge(raw).ok, false);
});

test('rejects an empty response', () => {
  for (const empty of ['', '   ', '\n\n', '```\n\n```']) {
    const result = validateJudge(empty);
    assert.equal(result.ok, false, `expected ${JSON.stringify(empty)} to be rejected`);
    assert.match(result.error, /empty/);
  }
});

test('rejects a seat outside the two allowed values', () => {
  const raw = JSON.stringify({
    agent_id: 'jon_snow',
    seat: 'witness',
    speech: 'A speech.',
    key_points: ['a point'],
  });
  const result = validateRepresentative(raw);
  assert.equal(result.ok, false);
  assert.match(result.error, /"seat"/);
});

test('rejects a missing field', () => {
  const raw = JSON.stringify({ judge_id: 'barak', verdict: 'justified', key_factors: [] });
  const result = validateJudge(raw);
  assert.equal(result.ok, false);
  assert.match(result.error, /"reasoning"/);
});

test('rejects wrong field types', () => {
  const notArray = JSON.stringify({
    judge_id: 'barak',
    verdict: 'justified',
    reasoning: 'Fine.',
    key_factors: 'a single factor',
  });
  assert.match(validateJudge(notArray).error, /must be an array/);

  const numberInArray = JSON.stringify({
    judge_id: 'barak',
    verdict: 'justified',
    reasoning: 'Fine.',
    key_factors: [1, 2],
  });
  assert.match(validateJudge(numberInArray).error, /non-empty strings/);

  const emptySpeech = JSON.stringify({
    agent_id: 'jon_snow',
    seat: 'defense',
    speech: '   ',
    key_points: [],
  });
  assert.match(validateRepresentative(emptySpeech).error, /must not be empty/);
});

test('rejects JSON that is not an object', () => {
  assert.match(validateJudge('[1,2,3]').error, /not a JSON object/);
  assert.match(validateJudge('null').error, /not a JSON object/);
  assert.match(validateJudge('"a string"').error, /not a JSON object/);
});

test('drops fields outside the contract', () => {
  const raw = JSON.stringify({
    judge_id: 'barak',
    verdict: 'justified',
    reasoning: 'Fine.',
    key_factors: ['a factor'],
    sentence: '5 years',
    confidence: 0.9,
  });
  const result = validateJudge(raw);
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.value), ['judge_id', 'verdict', 'reasoning', 'key_factors']);
});

test('does not throw on non-string input', () => {
  assert.equal(validateJudge(undefined).ok, false);
  assert.equal(validateJudge(null).ok, false);
  assert.equal(validateRepresentative(42).ok, false);
});
