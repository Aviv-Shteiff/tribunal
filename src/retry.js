// One model call, gated, recorded and validated — with exactly one corrective
// retry on a validation failure (spec.md §5).
//
// A transport failure is not retried: the spec grants the retry to validation
// failure only. This function never throws past the caller; a failure comes
// back as a failed result.

import { callModel as defaultCallModel, ModelCallError } from './model-client.js';

export const MAX_ATTEMPTS = 2;

export async function callWithValidation({
  agentId,
  modelId,
  systemPrompt,
  userMessage,
  validate,
  gate,
  recorder,
  transport,
  callModel = defaultCallModel,
}) {
  let message = userMessage;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const gateCheck = gate.check();
    if (!gateCheck.allowed) {
      return { status: 'budget_stopped', agentId, reason: gateCheck.reason, attempts: attempt - 1 };
    }

    let call;
    try {
      call = await callModel({ modelId, systemPrompt, userMessage: message, transport });
    } catch (err) {
      const failure = err instanceof ModelCallError ? err : new ModelCallError(err.message);
      recorder.append({
        agentId,
        modelId,
        durationMs: failure.durationMs,
        attempt,
        validation: 'call_failed',
        error: failure.message,
      });
      return { status: 'failed', agentId, error: failure.message, attempts: attempt };
    }

    // The call was paid for whether or not its output is usable.
    gate.record(call.cost);

    const result = validate(call.text);
    recorder.append({
      agentId,
      modelId,
      promptTokens: call.promptTokens,
      completionTokens: call.completionTokens,
      cost: call.cost,
      durationMs: call.durationMs,
      attempt,
      validation: result.ok ? 'valid' : 'invalid',
      error: result.ok ? null : result.error,
    });

    if (result.ok) {
      return { status: 'ok', agentId, value: result.value, attempts: attempt };
    }

    if (attempt < MAX_ATTEMPTS) {
      message = correctiveMessage(userMessage, result.error);
      continue;
    }

    return {
      status: 'failed',
      agentId,
      error: `validation failed after ${MAX_ATTEMPTS} attempts: ${result.error}`,
      attempts: attempt,
    };
  }
}

export function correctiveMessage(original, error) {
  return (
    `${original}\n\n` +
    `Your previous response was rejected: ${error}. ` +
    'Reply with a single JSON object matching the required shape exactly. ' +
    'No commentary, no code fences.'
  );
}
