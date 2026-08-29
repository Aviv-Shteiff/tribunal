// Pure selection logic over a live OpenRouter model list (spec.md §4):
// "Prefer zero-cost models. Selection filters on price first, capability
// second." No model id is ever written here — the list is the only source.
//
// Takes the raw array from fetchModelList() and returns the model to use.
// No network here, so this is fully unit-testable against a fake list.

/**
 * A judge's real input is unknown ahead of time — it depends on how long the
 * four representatives' speeches turn out to be, and spec.md §9 leaves max
 * speech length open until this turn's real run reports token counts. This
 * floor is a conservative pre-flight estimate, not a measured value: charge
 * sheet (~1,000 tokens for the reference case) + four unconstrained speeches
 * (budgeted generously at ~1,500 tokens each) + persona and output-contract
 * instructions (~1,000 tokens) + margin for a corrective retry. A model
 * below this is excluded before spending anything on it, rather than
 * discovered mid-run by a context-length error from the API.
 */
export const MIN_CONTEXT_TOKENS = 12_000;

/**
 * @param {Array<object>} models - raw entries from OpenRouter's /models
 * @param {{minContextTokens?: number}} [options]
 * @returns {{ok: true, model: object, candidates: number} | {ok: false, reason: string}}
 */
export function selectCheapestModel(models, { minContextTokens = MIN_CONTEXT_TOKENS } = {}) {
  if (!Array.isArray(models)) {
    return { ok: false, reason: 'model list was not an array' };
  }

  const candidates = models
    .map(normalizeModel)
    .filter((m) => m !== null && m.contextLength >= minContextTokens);

  if (candidates.length === 0) {
    return {
      ok: false,
      reason:
        `no model in the live list has both a usable price and at least ` +
        `${minContextTokens} tokens of context`,
    };
  }

  // Price first, capability (context length) second — spec.md §4.
  candidates.sort((a, b) => {
    if (a.totalPrice !== b.totalPrice) return a.totalPrice - b.totalPrice;
    return b.contextLength - a.contextLength;
  });

  return { ok: true, model: candidates[0], candidates: candidates.length };
}

function normalizeModel(raw) {
  const promptPrice = toNonNegativeNumber(raw?.pricing?.prompt);
  const completionPrice = toNonNegativeNumber(raw?.pricing?.completion);
  const contextLength = toNonNegativeNumber(raw?.context_length);
  if (
    typeof raw?.id !== 'string' ||
    raw.id === '' ||
    promptPrice === null ||
    completionPrice === null ||
    contextLength === null
  ) {
    return null;
  }
  return {
    id: raw.id,
    promptPrice,
    completionPrice,
    totalPrice: promptPrice + completionPrice,
    contextLength,
  };
}

function toNonNegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
