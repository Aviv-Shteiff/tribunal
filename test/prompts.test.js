import test from 'node:test';
import assert from 'node:assert/strict';

import { buildJudgePrompt, buildRepresentativePrompt, TOTAL_REPRESENTATIVES } from '../src/prompts.js';
import { REPRESENTATIVES, JUDGES } from '../src/personas.js';

const CASE_TEXT = 'The Realm v. Jon Snow. Was the killing justified?';

test('a representative prompt states the exact JSON shape and its own id/seat', () => {
  const jonSnow = REPRESENTATIVES.find((r) => r.id === 'jon_snow');
  const { systemPrompt } = buildRepresentativePrompt(jonSnow, CASE_TEXT);

  assert.match(systemPrompt, /"agent_id"/);
  assert.match(systemPrompt, /"seat"/);
  assert.match(systemPrompt, /"speech"/);
  assert.match(systemPrompt, /"key_points"/);
  assert.match(systemPrompt, /"jon_snow"/);
  assert.match(systemPrompt, /"defense"/);
  assert.match(systemPrompt, /no code fences/);
});

test('a representative sees only the charge sheet, never another speech', () => {
  const jonSnow = REPRESENTATIVES.find((r) => r.id === 'jon_snow');
  const { userMessage } = buildRepresentativePrompt(jonSnow, CASE_TEXT);

  assert.equal(userMessage, CASE_TEXT);
  assert.doesNotMatch(userMessage, /tyrion|daenerys|grey_worm/i);
});

test('every representative persona produces a prompt naming only itself', () => {
  for (const persona of REPRESENTATIVES) {
    const { systemPrompt } = buildRepresentativePrompt(persona, CASE_TEXT);
    for (const other of REPRESENTATIVES) {
      if (other.id === persona.id) continue;
      assert.doesNotMatch(
        systemPrompt,
        new RegExp(`"${other.id}"`),
        `${persona.id}'s prompt must not name ${other.id}`,
      );
    }
  }
});

test('a judge prompt states the exact JSON shape and both allowed verdict strings', () => {
  const barak = JUDGES.find((j) => j.id === 'barak');
  const { systemPrompt } = buildJudgePrompt(barak, CASE_TEXT, []);

  assert.match(systemPrompt, /"judge_id"/);
  assert.match(systemPrompt, /"verdict"/);
  assert.match(systemPrompt, /"reasoning"/);
  assert.match(systemPrompt, /"key_factors"/);
  assert.match(systemPrompt, /"justified"/);
  assert.match(systemPrompt, /"not justified"/);
  assert.match(systemPrompt, /"barak"/);
  assert.match(systemPrompt, /do not see the other judges/);
});

test("a judge's input carries the charge sheet and every speech, labeled by seat and id", () => {
  const barak = JUDGES.find((j) => j.id === 'barak');
  const speeches = [
    { agentId: 'jon_snow', seat: 'defense', speech: 'He acted to prevent a greater harm.' },
    { agentId: 'daenerys_targaryen', seat: 'prosecution', speech: 'There was no trial, no warning.' },
  ];
  const { userMessage } = buildJudgePrompt(barak, CASE_TEXT, speeches);

  assert.match(userMessage, /The Realm v\. Jon Snow/);
  assert.match(userMessage, /He acted to prevent a greater harm\./);
  assert.match(userMessage, /There was no trial, no warning\./);
  assert.match(userMessage, /defense — jon_snow/);
  assert.match(userMessage, /prosecution — daenerys_targaryen/);
});

test('a judge never sees another judge\'s persona or output', () => {
  const barak = JUDGES.find((j) => j.id === 'barak');
  const { systemPrompt, userMessage } = buildJudgePrompt(barak, CASE_TEXT, []);
  for (const other of JUDGES) {
    if (other.id === barak.id) continue;
    assert.doesNotMatch(systemPrompt, new RegExp(`"${other.id}"`));
    assert.doesNotMatch(userMessage, new RegExp(other.id));
  }
});

test('a partial speech list is labeled with the actual count, not presented as complete', () => {
  const barak = JUDGES.find((j) => j.id === 'barak');
  const twoOfFour = [
    { agentId: 'jon_snow', seat: 'defense', speech: 'A.' },
    { agentId: 'tyrion_lannister', seat: 'defense', speech: 'B.' },
  ];
  const { userMessage } = buildJudgePrompt(barak, CASE_TEXT, twoOfFour);

  assert.match(userMessage, new RegExp(`2 of ${TOTAL_REPRESENTATIVES} representatives responded`));
});

test('a full speech list is labeled as complete, not counted out', () => {
  const barak = JUDGES.find((j) => j.id === 'barak');
  const all = REPRESENTATIVES.map((r) => ({ agentId: r.id, seat: r.seat, speech: `${r.id} speaks.` }));
  const { userMessage } = buildJudgePrompt(barak, CASE_TEXT, all);

  assert.match(userMessage, new RegExp(`All ${TOTAL_REPRESENTATIVES} representatives responded\\.`));
});

test('zero surviving speeches is stated plainly, not hidden', () => {
  const barak = JUDGES.find((j) => j.id === 'barak');
  const { userMessage } = buildJudgePrompt(barak, CASE_TEXT, []);

  assert.match(userMessage, /0 of 4 representatives responded/);
  assert.match(userMessage, /no representative speeches are available/);
});
