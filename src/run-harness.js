// The sequencer: runs a list of call requests through the gate, the retry rule
// and the recorder, and stops the run the moment the budget gate refuses.
//
// Calls are made one at a time. spec.md §3 has representatives and judges
// running in parallel, but §6 requires the running total to be checked before
// each call, and concurrent calls would race that check. Sequential is the
// reading that keeps the gate meaningful; parallelism is left to the turn that
// builds the pipeline.

import { callWithValidation } from './retry.js';

/**
 * @param {Array<{agentId: string, modelId: string, systemPrompt: string,
 *                userMessage: string, validate: Function}>} requests
 */
export async function executeCalls(requests, { gate, recorder, transport, callModel }) {
  const results = [];
  let stopReason = null;

  for (const [index, request] of requests.entries()) {
    const gateCheck = gate.check();
    if (!gateCheck.allowed) {
      stopReason = gateCheck.reason;
      return report(results, requests.slice(index), stopReason, recorder);
    }

    const result = await callWithValidation({
      ...request,
      gate,
      recorder,
      transport,
      callModel,
    });
    results.push(result);

    if (result.status === 'budget_stopped') {
      stopReason = result.reason;
      return report(results, requests.slice(index + 1), stopReason, recorder);
    }
  }

  return report(results, [], null, recorder);
}

function report(results, notAttempted, stopReason, recorder) {
  return {
    results,
    completedAgents: results.filter((r) => r.status === 'ok').map((r) => r.agentId),
    failedAgents: results.filter((r) => r.status === 'failed').map((r) => r.agentId),
    notAttemptedAgents: notAttempted.map((r) => r.agentId),
    stopped: stopReason !== null,
    stopReason,
    totals: recorder.totals(),
  };
}
