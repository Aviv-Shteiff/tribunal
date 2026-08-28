import test from 'node:test';
import assert from 'node:assert/strict';

import { callModel, fetchModelList, ModelCallError } from '../src/model-client.js';
import { fakeTransport, VALID_JUDGE } from './fake-client.js';

test('returns the text and the usage the API reported, verbatim', async () => {
  const transport = fakeTransport([
    { content: VALID_JUDGE, promptTokens: 812, completionTokens: 149, cost: 0.00042 },
  ]);

  const result = await callModel({
    modelId: 'fake/model-under-test',
    systemPrompt: 'system',
    userMessage: 'user',
    transport,
  });

  assert.equal(result.text, VALID_JUDGE);
  assert.equal(result.promptTokens, 812);
  assert.equal(result.completionTokens, 149);
  assert.equal(result.cost, 0.00042);
  assert.ok(Number.isFinite(result.durationMs) && result.durationMs >= 0);
});

test('sends the model id and both prompts', async () => {
  const transport = fakeTransport([{ content: VALID_JUDGE }]);
  await callModel({
    modelId: 'fake/model-under-test',
    systemPrompt: 'you are a judge',
    userMessage: 'the charge sheet',
    transport,
  });

  const body = transport.calls[0];
  assert.equal(body.model, 'fake/model-under-test');
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'you are a judge' },
    { role: 'user', content: 'the charge sheet' },
  ]);
});

test('leaves cost null when the API reports none — never estimates it', async () => {
  const transport = fakeTransport([{ content: VALID_JUDGE, cost: null }]);
  const result = await callModel({ modelId: 'm', systemPrompt: 's', userMessage: 'u', transport });
  assert.equal(result.cost, null);
  assert.equal(result.promptTokens, 10);
});

test('raises ModelCallError when the transport fails', async () => {
  const transport = fakeTransport([{ throws: 'socket hang up' }]);
  await assert.rejects(
    () => callModel({ modelId: 'm', systemPrompt: 's', userMessage: 'u', transport }),
    (err) => err instanceof ModelCallError && /socket hang up/.test(err.message),
  );
});

test('raises ModelCallError on an error envelope', async () => {
  const transport = fakeTransport([
    { envelope: { error: { message: 'rate limited', code: 429 } } },
  ]);
  await assert.rejects(
    () => callModel({ modelId: 'm', systemPrompt: 's', userMessage: 'u', transport }),
    (err) => err instanceof ModelCallError && /rate limited/.test(err.message),
  );
});

test('raises ModelCallError when the envelope has no choices', async () => {
  const transport = fakeTransport([{ envelope: { choices: [] } }]);
  await assert.rejects(
    () => callModel({ modelId: 'm', systemPrompt: 's', userMessage: 'u', transport }),
    (err) => err instanceof ModelCallError && /no choices/.test(err.message),
  );
});

test('an absent message content becomes an empty string, for the validator to reject', async () => {
  const transport = fakeTransport([
    { envelope: { choices: [{ message: {} }], usage: { prompt_tokens: 5, completion_tokens: 0 } } },
  ]);
  const result = await callModel({ modelId: 'm', systemPrompt: 's', userMessage: 'u', transport });
  assert.equal(result.text, '');
});

test('fetchModelList returns the data array from the response', async () => {
  const models = [
    { id: 'free/a', pricing: { prompt: '0', completion: '0' }, context_length: 32000 },
    { id: 'free/b', pricing: { prompt: '0', completion: '0' }, context_length: 8000 },
  ];
  const list = await fetchModelList({ transport: async () => ({ data: models }) });
  assert.deepEqual(list, models);
});

test('fetchModelList rejects a response with no data array', async () => {
  await assert.rejects(
    () => fetchModelList({ transport: async () => ({ oops: true }) }),
    /did not contain a data array/,
  );
});

test('fetchModelList propagates a transport failure', async () => {
  await assert.rejects(
    () => fetchModelList({ transport: async () => { throw new Error('DNS failure'); } }),
    /DNS failure/,
  );
});
