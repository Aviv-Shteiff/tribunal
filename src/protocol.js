// The protocol: one record per model call, and the run totals derived from
// those records. Nothing here estimates — totals are sums of recorded values
// (spec.md §6).

/**
 * @typedef {'valid'|'invalid'|'call_failed'} ValidationOutcome
 */

export class ProtocolRecorder {
  #records = [];

  /**
   * Append one record per model call. `cost`, `promptTokens` and
   * `completionTokens` are null when the API did not report them (a failed
   * call reports nothing); they are never filled in with a guess.
   */
  append({
    agentId,
    modelId,
    promptTokens = null,
    completionTokens = null,
    cost = null,
    durationMs,
    attempt,
    validation,
    error = null,
    timestamp = new Date().toISOString(),
  }) {
    const record = Object.freeze({
      agentId,
      modelId,
      promptTokens,
      completionTokens,
      cost,
      durationMs,
      timestamp,
      attempt,
      validation,
      error,
    });
    this.#records.push(record);
    return record;
  }

  get records() {
    return [...this.#records];
  }

  /**
   * Run summary. `callsWithUnknownCost` exists so a total is never quietly
   * short: a call whose cost the API omitted contributes nothing to costUsd
   * and is counted here instead.
   */
  totals() {
    let promptTokens = 0;
    let completionTokens = 0;
    let costUsd = 0;
    let durationMs = 0;
    let callsWithUnknownCost = 0;

    for (const r of this.#records) {
      promptTokens += r.promptTokens ?? 0;
      completionTokens += r.completionTokens ?? 0;
      durationMs += r.durationMs ?? 0;
      if (typeof r.cost === 'number') costUsd += r.cost;
      else callsWithUnknownCost += 1;
    }

    return {
      calls: this.#records.length,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      costUsd,
      durationMs,
      callsWithUnknownCost,
    };
  }
}
