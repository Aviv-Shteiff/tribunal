// Prompt assembly (spec.md §5, docs/agent-profiles.md "Output requirements").
// Builds the exact system prompt and user message for a representative call
// and, separately, a judge call. The output shape is stated here in plain
// language for the model, and enforced separately, in code, by validate.js —
// stating it is not the same as trusting it.

import { REPRESENTATIVES, SIMULATION_RULE } from './personas.js';

export const TOTAL_REPRESENTATIVES = REPRESENTATIVES.length;

/**
 * @param {{id: string, name: string, seat: string, profile: string}} persona
 * @param {string} caseText - the charge sheet, verbatim
 */
export function buildRepresentativePrompt(persona, caseText) {
  const systemPrompt = [
    `You are ${persona.name}, appearing before a tribunal in the ${persona.seat} seat.`,
    persona.profile,
    SIMULATION_RULE,
    representativeOutputInstructions(persona),
  ].join('\n\n');

  return { systemPrompt, userMessage: caseText.trim() };
}

/**
 * @param {{id: string, name: string, profile: string}} judge
 * @param {string} caseText - the charge sheet, verbatim
 * @param {Array<{agentId: string, seat: string, speech: string}>} speeches
 *        only the representatives whose speech passed validation
 */
export function buildJudgePrompt(judge, caseText, speeches) {
  const systemPrompt = [
    `You are ${judge.name}, one of three judges on this tribunal. You rule ` +
      'independently and do not see the other judges\' opinions or reasoning.',
    judge.profile,
    judgeOutputInstructions(judge),
  ].join('\n\n');

  const respondedNote =
    speeches.length === TOTAL_REPRESENTATIVES
      ? `All ${TOTAL_REPRESENTATIVES} representatives responded.`
      : `${speeches.length} of ${TOTAL_REPRESENTATIVES} representatives ` +
        'responded; the rest failed to produce a usable speech and are not ' +
        'included below.';

  const speechBlocks = speeches
    .map((s) => `${s.seat} — ${s.agentId}:\n${s.speech}`)
    .join('\n\n---\n\n');

  const userMessage = [
    `Charge sheet:\n\n${caseText.trim()}`,
    respondedNote,
    speechBlocks || '(no representative speeches are available)',
  ].join('\n\n---\n\n');

  return { systemPrompt, userMessage };
}

function representativeOutputInstructions(persona) {
  return (
    'Respond with a single JSON object and nothing else — no preamble, no ' +
    'commentary, no code fences. The object must have exactly these fields:\n' +
    '{\n' +
    `  "agent_id": "${persona.id}",\n` +
    `  "seat": "${persona.seat}",\n` +
    '  "speech": "<your spoken argument, in character>",\n' +
    '  "key_points": ["<a distinct point your speech makes>", "..."]\n' +
    '}\n' +
    `"agent_id" must be exactly "${persona.id}". "seat" must be exactly ` +
    `"${persona.seat}". Nothing outside this JSON object.`
  );
}

function judgeOutputInstructions(judge) {
  return (
    'Respond with a single JSON object and nothing else — no preamble, no ' +
    'commentary, no code fences. The object must have exactly these fields:\n' +
    '{\n' +
    `  "judge_id": "${judge.id}",\n` +
    '  "verdict": "justified",\n' +
    '  "reasoning": "<your reasoning, in character>",\n' +
    '  "key_factors": ["<a factor that drove your ruling>", "..."]\n' +
    '}\n' +
    `"judge_id" must be exactly "${judge.id}". "verdict" must be exactly ` +
    '"justified" or exactly "not justified" — those two strings only, ' +
    'nothing else counts as a verdict. Nothing outside this JSON object.'
  );
}
