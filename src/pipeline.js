// Wires the fixed personas onto the harness: 4 representatives, sequential,
// each producing a speech; then 3 judges, sequential, each producing a
// verdict from the charge sheet and whichever speeches survived. Calls run
// one at a time — locked, not provisional (spec.md §3, D-009): the budget
// gate checks the running total before each call and concurrency would race
// it.
//
// A representative that fails validation twice (retry.js's one corrective
// retry exhausted) is simply absent from what the judges see; the judge
// prompt states the actual count rather than presenting four speeches when
// there were fewer. Decided with the user before this file was written.

import { findRepresentative, JUDGES, REPRESENTATIVES } from './personas.js';
import { buildJudgePrompt, buildRepresentativePrompt } from './prompts.js';
import { executeCalls } from './run-harness.js';
import { validateJudge, validateRepresentative } from './validate.js';

// spec.md §5, D-010: a representative speech is capped so two runs stay
// comparable when one model is far more verbose than another. The first real
// run's longest speech was 1,581 completion tokens; this leaves headroom and
// still keeps the worst-case judge input inside model-select.js's 12k floor.
export const MAX_SPEECH_TOKENS = 2000;

/**
 * Mode A passes `modelId` and every agent runs on it. Mode B passes
 * `modelByAgent` ({ [agentId]: modelId }, spec.md §4) and each agent runs on
 * its own; `modelId` is the fallback for any agent the map omits. The protocol
 * already records the model id per call (§6), so a Mode B run's record shows
 * which model served each agent with no extra plumbing.
 *
 * @param {{caseText: string, modelId?: string,
 *          modelByAgent?: Record<string, string>,
 *          gate: import('./budget.js').BudgetGate,
 *          recorder: import('./protocol.js').ProtocolRecorder,
 *          transport?: Function, callModel?: Function}} args
 */
export async function runTribunal({
  caseText,
  modelId,
  modelByAgent,
  gate,
  recorder,
  transport,
  callModel,
}) {
  const modelFor = (agentId) => modelByAgent?.[agentId] ?? modelId;

  const repRequests = REPRESENTATIVES.map((persona) => {
    const { systemPrompt, userMessage } = buildRepresentativePrompt(persona, caseText);
    return {
      agentId: persona.id,
      modelId: modelFor(persona.id),
      systemPrompt,
      userMessage,
      maxTokens: MAX_SPEECH_TOKENS,
      validate: validateRepresentative,
    };
  });

  const representatives = await executeCalls(repRequests, { gate, recorder, transport, callModel });

  // Labeled by our own bookkeeping (which persona was actually called), not
  // by the model's self-reported agent_id/seat — validate.js confirms those
  // fields are one of the allowed values, not that they match who was asked.
  const speeches = representatives.results
    .filter((r) => r.status === 'ok')
    .map((r) => ({
      agentId: r.agentId,
      seat: findRepresentative(r.agentId).seat,
      speech: r.value.speech,
    }));

  const judgeRequests = JUDGES.map((judge) => {
    const { systemPrompt, userMessage } = buildJudgePrompt(judge, caseText, speeches);
    return {
      agentId: judge.id,
      modelId: modelFor(judge.id),
      systemPrompt,
      userMessage,
      validate: validateJudge,
    };
  });

  const judges = await executeCalls(judgeRequests, { gate, recorder, transport, callModel });

  const verdicts = judges.results.filter((r) => r.status === 'ok').map((r) => r.value);

  return {
    modelId,
    modelByAgent: modelByAgent ?? null,
    speeches,
    verdicts,
    representatives,
    judges,
    totals: recorder.totals(),
  };
}
