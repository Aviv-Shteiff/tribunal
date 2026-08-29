import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from '../scripts/server.js';
import { JUDGES, REPRESENTATIVES } from '../src/personas.js';
import { fakeTransport } from './fake-client.js';

const RUNS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'runs');

// One qualifying model so resolveModeA's selectCheapestModel picks it; the
// fake transport means no network is touched regardless.
const FAKE_MODELS = [
  { id: 'fake/model', pricing: { prompt: '0', completion: '0' }, context_length: 200_000 },
];

const repEnvelope = (p) =>
  JSON.stringify({
    agent_id: p.id,
    seat: p.seat,
    speech: `${p.name} makes the argument.`,
    key_points: ['point one', 'point two'],
  });

const judgeEnvelope = (j, verdict) =>
  JSON.stringify({
    judge_id: j.id,
    verdict,
    reasoning: `${j.name} reasons through the record and concludes ${verdict}.`,
    key_factors: ['a factor'],
  });

function fullScript() {
  return [
    ...REPRESENTATIVES.map((p) => ({ content: repEnvelope(p), cost: 0.001 })),
    { content: judgeEnvelope(JUDGES[0], 'justified'), cost: 0.002 },
    { content: judgeEnvelope(JUDGES[1], 'not justified'), cost: 0.002 },
    { content: judgeEnvelope(JUDGES[2], 'justified'), cost: 0.002 },
  ];
}

async function listen(server) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server.address().port;
}

const postRun = (port, payload) =>
  fetch(`http://127.0.0.1:${port}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

test('POST /run returns the exact shape the page renders (fake client, Mode A)', async (t) => {
  const server = createServer({
    fetchModelList: async () => FAKE_MODELS,
    transport: fakeTransport(fullScript()),
    config: { apiKey: 'test-key', budgetUsd: 10 },
    persist: false,
  });
  const port = await listen(server);
  t.after(() => server.close());

  const resp = await postRun(port, { caseText: 'Was the killing justified?', mode: 'a' });
  assert.equal(resp.status, 200);
  const data = await resp.json();

  assert.equal(data.ok, true);
  assert.equal(data.mode, 'A');
  assert.equal(typeof data.modelSource, 'string');
  assert.equal(data.runFile, null); // persist:false → no record written

  // 4 representatives, canonical order, each with a status the page maps to a badge
  assert.deepEqual(
    data.representatives.map((r) => r.agentId),
    REPRESENTATIVES.map((r) => r.id),
  );
  for (const rep of data.representatives) {
    assert.equal(typeof rep.seat, 'string');
    assert.ok(['ok', 'failed', 'not attempted'].includes(rep.status));
  }
  assert.ok(data.representatives.every((r) => r.status === 'ok'));
  // turn-6 contract addition: each representative carries its speech text
  // (a string when status is ok), so the page can render it.
  assert.ok(data.representatives.every((r) => typeof r.speech === 'string' && r.speech.length > 0));

  // 3 verdicts with the fields the page reads
  assert.equal(data.verdicts.length, 3);
  for (const v of data.verdicts) {
    assert.equal(typeof v.judge_id, 'string');
    assert.ok(['justified', 'not justified'].includes(v.verdict));
    assert.equal(typeof v.reasoning, 'string');
    assert.ok(v.reasoning.length > 0);
  }

  // totals straight from the recorder, not recomputed in the server
  assert.equal(data.totals.calls, 7);
  assert.equal(data.totals.callsWithUnknownCost, 0);
  assert.ok(Math.abs(data.totals.costUsd - (4 * 0.001 + 3 * 0.002)) < 1e-9);
  assert.equal(typeof data.totals.promptTokens, 'number');
  assert.equal(typeof data.wallClockMs, 'number');

  assert.equal(data.stopped, false);
  assert.equal(data.stopReason, null);
});

test('POST /run reports a failed judge: fewer verdicts, judges.failed names it', async (t) => {
  const badJudge = JUDGES[1]; // elon
  const script = [
    ...REPRESENTATIVES.map((p) => ({ content: repEnvelope(p), cost: 0.001 })),
    { content: judgeEnvelope(JUDGES[0], 'justified'), cost: 0.002 },
    { content: 'not json', cost: 0.002 }, // attempt 1
    { content: 'still not json', cost: 0.002 }, // attempt 2 (the one corrective retry)
    { content: judgeEnvelope(JUDGES[2], 'not justified'), cost: 0.002 },
  ];
  const server = createServer({
    fetchModelList: async () => FAKE_MODELS,
    transport: fakeTransport(script),
    config: { apiKey: 'test-key', budgetUsd: 10 },
    persist: false,
  });
  const port = await listen(server);
  t.after(() => server.close());

  const data = await (await postRun(port, { caseText: 'a case', mode: 'a' })).json();
  assert.equal(data.ok, true);
  assert.equal(data.verdicts.length, 2);
  assert.deepEqual(data.judges.failed, [badJudge.id]);
  assert.deepEqual(data.judges.completed, [JUDGES[0].id, JUDGES[2].id]);
  assert.equal(data.stopped, false);
});

test('POST /run: a representative that fails validation twice has status failed and speech null', async (t) => {
  const badRep = REPRESENTATIVES[1]; // tyrion_lannister
  const script = [
    { content: repEnvelope(REPRESENTATIVES[0]), cost: 0.001 },
    { content: 'not json', cost: 0.001 }, // badRep attempt 1
    { content: 'still not json', cost: 0.001 }, // badRep attempt 2
    { content: repEnvelope(REPRESENTATIVES[2]), cost: 0.001 },
    { content: repEnvelope(REPRESENTATIVES[3]), cost: 0.001 },
    ...JUDGES.map((j) => ({ content: judgeEnvelope(j, 'justified'), cost: 0.002 })),
  ];
  const server = createServer({
    fetchModelList: async () => FAKE_MODELS,
    transport: fakeTransport(script),
    config: { apiKey: 'test-key', budgetUsd: 10 },
    persist: false,
  });
  const port = await listen(server);
  t.after(() => server.close());

  const data = await (await postRun(port, { caseText: 'a case', mode: 'a' })).json();
  const failed = data.representatives.find((r) => r.agentId === badRep.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.speech, null);
  for (const r of data.representatives.filter((r) => r.agentId !== badRep.id)) {
    assert.equal(r.status, 'ok');
    assert.equal(typeof r.speech, 'string');
  }
});

test('POST /run persists the completed run to runs/ (spec.md §6)', async (t) => {
  const server = createServer({
    fetchModelList: async () => FAKE_MODELS,
    transport: fakeTransport(fullScript()),
    config: { apiKey: 'test-key', budgetUsd: 10 },
    // persist left at its default (true)
  });
  const port = await listen(server);
  t.after(() => server.close());

  const data = await (await postRun(port, { caseText: 'a case', mode: 'a' })).json();
  assert.match(data.runFile, /^run-.*\.json$/);
  t.after(() => rmSync(path.join(RUNS_DIR, data.runFile), { force: true }));
});

test('GET / serves the page with the charge sheet pre-filled, placeholder gone', async (t) => {
  const server = createServer();
  const port = await listen(server);
  t.after(() => server.close());

  const resp = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(resp.status, 200);
  assert.match(resp.headers.get('content-type'), /text\/html/);

  const html = await resp.text();
  assert.match(html, /<textarea id="case">/);
  assert.doesNotMatch(html, /\{\{CHARGE_SHEET\}\}/);
  assert.match(html, /Jon Snow/); // the fixture's charge sheet landed in the page
});

test('POST /run validates its two inputs before running anything', async (t) => {
  const server = createServer({
    fetchModelList: async () => {
      throw new Error('should not fetch — validation must fail first');
    },
    config: { apiKey: 'test-key', budgetUsd: 10 },
  });
  const port = await listen(server);
  t.after(() => server.close());

  const empty = await postRun(port, { caseText: '   ', mode: 'a' });
  assert.equal(empty.status, 400);
  assert.match((await empty.json()).error, /empty/);

  const badMode = await postRun(port, { caseText: 'a case', mode: 'c' });
  assert.equal(badMode.status, 400);
  assert.match((await badMode.json()).error, /mode/);
});

test('a second POST /run while one is in flight gets 409', async (t) => {
  let release;
  const barrier = new Promise((r) => (release = r));
  const server = createServer({
    // Block the run at its first await so the second request overlaps.
    fetchModelList: async () => {
      await barrier;
      return FAKE_MODELS;
    },
    transport: fakeTransport(fullScript()),
    config: { apiKey: 'test-key', budgetUsd: 10 },
    persist: false,
  });
  const port = await listen(server);
  t.after(() => {
    release();
    server.close();
  });

  const first = postRun(port, { caseText: 'x', mode: 'a' });
  await new Promise((r) => setTimeout(r, 60)); // let the first acquire the lock
  const second = await postRun(port, { caseText: 'x', mode: 'a' });
  assert.equal(second.status, 409);
  assert.match((await second.json()).error, /in progress/);

  release();
  const firstResp = await first;
  assert.equal(firstResp.status, 200);
});
