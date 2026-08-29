import test from 'node:test';
import assert from 'node:assert/strict';

import { BudgetGate } from '../src/budget.js';
import { ProtocolRecorder } from '../src/protocol.js';
import { JUDGES, REPRESENTATIVES } from '../src/personas.js';
import { runTribunal } from '../src/pipeline.js';
import { fakeTransport } from './fake-client.js';

const CASE_TEXT = 'Case T-001: The Realm v. Jon Snow. Was the killing justified?';

function repEnvelope(persona, verdictLeaning) {
  return JSON.stringify({
    agent_id: persona.id,
    seat: persona.seat,
    speech: `${persona.name} argues: ${verdictLeaning}.`,
    key_points: [`${persona.id} point one`, `${persona.id} point two`],
  });
}

function judgeEnvelope(judge, verdict) {
  return JSON.stringify({
    judge_id: judge.id,
    verdict,
    reasoning: `${judge.name} reasons through the record and concludes ${verdict}.`,
    key_factors: [`${judge.id} factor one`],
  });
}

// The single required integration test — fake client only, safe for CI.
// Structured as one test with subtests so it stands as the one asked for,
// while still covering the pipeline's distinct guarantees separately.
test('the pipeline: 4 representatives then 3 judges, sequential and isolated', async (t) => {
  await t.test('a full run produces 4 speeches and 3 verdicts, each a valid string', async () => {
    const script = [
      ...REPRESENTATIVES.map((p) => ({ content: repEnvelope(p, 'the act was necessary') })),
      { content: judgeEnvelope(JUDGES[0], 'justified') },
      { content: judgeEnvelope(JUDGES[1], 'not justified') },
      { content: judgeEnvelope(JUDGES[2], 'justified') },
    ];
    const transport = fakeTransport(script);
    const gate = new BudgetGate(10);
    const recorder = new ProtocolRecorder();

    const report = await runTribunal({ caseText: CASE_TEXT, modelId: 'fake/model', gate, recorder, transport });

    assert.equal(report.speeches.length, 4);
    assert.equal(report.verdicts.length, 3);
    for (const v of report.verdicts) {
      assert.ok(['justified', 'not justified'].includes(v.verdict));
    }
    assert.deepEqual(
      report.speeches.map((s) => s.agentId).sort(),
      REPRESENTATIVES.map((p) => p.id).sort(),
    );
    assert.deepEqual(
      report.verdicts.map((v) => v.judge_id).sort(),
      JUDGES.map((j) => j.id).sort(),
    );
  });

  await t.test('calls happen sequentially, all 4 representatives before any judge', async () => {
    const script = [
      ...REPRESENTATIVES.map((p) => ({ content: repEnvelope(p, 'x') })),
      ...JUDGES.map((j) => ({ content: judgeEnvelope(j, 'justified') })),
    ];
    const transport = fakeTransport(script);
    const gate = new BudgetGate(10);
    const recorder = new ProtocolRecorder();

    await runTribunal({ caseText: CASE_TEXT, modelId: 'fake/model', gate, recorder, transport });

    assert.equal(transport.calls.length, 7);
    // No two calls overlap: the fake transport is called and resolved in
    // order by callWithValidation's await, so call order below is call order
    // in time. First four are representatives, in personas.js order.
    const repIds = REPRESENTATIVES.map((p) => p.id);
    const judgeIds = JUDGES.map((j) => j.id);
    // Confirm identity by system prompt content (states the persona id) in order.
    for (let i = 0; i < 4; i += 1) {
      assert.match(transport.calls[i].messages[0].content, new RegExp(`"${repIds[i]}"`));
    }
    for (let i = 0; i < 3; i += 1) {
      assert.match(transport.calls[4 + i].messages[0].content, new RegExp(`"${judgeIds[i]}"`));
    }
  });

  await t.test('representative calls are capped at 2000 tokens; judge calls are not', async () => {
    const script = [
      ...REPRESENTATIVES.map((p) => ({ content: repEnvelope(p, 'x') })),
      ...JUDGES.map((j) => ({ content: judgeEnvelope(j, 'justified') })),
    ];
    const transport = fakeTransport(script);

    await runTribunal({
      caseText: CASE_TEXT,
      modelId: 'fake/model',
      gate: new BudgetGate(10),
      recorder: new ProtocolRecorder(),
      transport,
    });

    for (let i = 0; i < 4; i += 1) {
      assert.equal(transport.calls[i].max_tokens, 2000);
    }
    for (let i = 4; i < 7; i += 1) {
      assert.ok(!('max_tokens' in transport.calls[i]));
    }
  });

  await t.test('a representative sees only the charge sheet, and judges see all 4 speeches', async () => {
    const script = [
      ...REPRESENTATIVES.map((p) => ({ content: repEnvelope(p, 'x') })),
      ...JUDGES.map((j) => ({ content: judgeEnvelope(j, 'justified') })),
    ];
    const transport = fakeTransport(script);
    const gate = new BudgetGate(10);
    const recorder = new ProtocolRecorder();

    await runTribunal({ caseText: CASE_TEXT, modelId: 'fake/model', gate, recorder, transport });

    for (let i = 0; i < 4; i += 1) {
      assert.equal(transport.calls[i].messages[1].content, CASE_TEXT);
    }
    for (let i = 4; i < 7; i += 1) {
      const userMessage = transport.calls[i].messages[1].content;
      assert.match(userMessage, /All 4 representatives responded\./);
      for (const p of REPRESENTATIVES) {
        assert.match(userMessage, new RegExp(`${p.seat} — ${p.id}`));
      }
    }
  });

  await t.test('a judge never sees another judge\'s system prompt content', async () => {
    const script = [
      ...REPRESENTATIVES.map((p) => ({ content: repEnvelope(p, 'x') })),
      ...JUDGES.map((j) => ({ content: judgeEnvelope(j, 'justified') })),
    ];
    const transport = fakeTransport(script);
    await runTribunal({
      caseText: CASE_TEXT,
      modelId: 'fake/model',
      gate: new BudgetGate(10),
      recorder: new ProtocolRecorder(),
      transport,
    });

    for (let i = 4; i < 7; i += 1) {
      const systemPrompt = transport.calls[i].messages[0].content;
      for (const j of JUDGES) {
        if (JUDGES[i - 4].id === j.id) continue;
        assert.doesNotMatch(systemPrompt, new RegExp(`"${j.id}"`));
      }
    }
  });

  await t.test('one record per call; totals sum to the protocol', async () => {
    const script = [
      ...REPRESENTATIVES.map((p) => ({ content: repEnvelope(p, 'x'), cost: 0.001 })),
      ...JUDGES.map((j) => ({ content: judgeEnvelope(j, 'justified'), cost: 0.002 })),
    ];
    const transport = fakeTransport(script);
    const recorder = new ProtocolRecorder();

    const report = await runTribunal({
      caseText: CASE_TEXT,
      modelId: 'fake/model',
      gate: new BudgetGate(10),
      recorder,
      transport,
    });

    assert.equal(recorder.records.length, 7);
    assert.equal(report.totals.calls, 7);
    assert.ok(Math.abs(report.totals.costUsd - (4 * 0.001 + 3 * 0.002)) < 1e-9);
  });

  await t.test('a failed representative is excluded and the judges are told the real count', async () => {
    const failingId = REPRESENTATIVES[1].id; // tyrion_lannister
    const script = REPRESENTATIVES.map((p) =>
      p.id === failingId
        ? { content: 'not json', cost: 0.001 } // attempt 1: fails
        : { content: repEnvelope(p, 'x'), cost: 0.001 },
    );
    // insert the failing agent's second (also-failing) attempt right after its first
    const failingIndex = REPRESENTATIVES.findIndex((p) => p.id === failingId);
    script.splice(failingIndex + 1, 0, { content: 'still not json', cost: 0.001 });
    script.push(...JUDGES.map((j) => ({ content: judgeEnvelope(j, 'justified'), cost: 0.002 })));

    const transport = fakeTransport(script);
    const recorder = new ProtocolRecorder();

    const report = await runTribunal({
      caseText: CASE_TEXT,
      modelId: 'fake/model',
      gate: new BudgetGate(10),
      recorder,
      transport,
    });

    assert.equal(report.speeches.length, 3);
    assert.ok(!report.speeches.some((s) => s.agentId === failingId));
    assert.deepEqual(
      report.representatives.failedAgents,
      [failingId],
    );

    const judgeUserMessage = transport.calls.at(-1).messages[1].content;
    assert.match(judgeUserMessage, /3 of 4 representatives responded/);
    assert.doesNotMatch(judgeUserMessage, new RegExp(failingId));
  });
});
