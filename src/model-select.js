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
 * A representative's input is small and bounded: the charge sheet (~1,100
 * tokens for the reference case) + persona and contract instructions (~1,000)
 * + the 2,000-token completion cap (spec.md §5, D-010) + margin for one
 * corrective retry. A representative never sees another speech. 6,000 tokens
 * covers it comfortably and lets Mode B give a representative a
 * smaller-context model than a judge could take.
 */
export const REPRESENTATIVE_MIN_CONTEXT_TOKENS = 6_000;

const ROLE_CONTEXT_FLOOR = Object.freeze({
  representative: REPRESENTATIVE_MIN_CONTEXT_TOKENS,
  judge: MIN_CONTEXT_TOKENS,
});

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

/**
 * Mode B (spec.md §4): bind each agent to its own model, resolved from the
 * live list the same way Mode A resolves its one model — cheapest first,
 * context second — and never reused across agents. Deterministic: same list,
 * same agent order, same result.
 *
 * The earliest agent in `agents` gets the cheapest qualifying model. A judge
 * must clear MIN_CONTEXT_TOKENS; a representative only REPRESENTATIVE_MIN_-
 * CONTEXT_TOKENS. If the list cannot supply an unused model for some agent the
 * result is a failure naming that agent — models are never shared (D-011).
 *
 * @param {Array<object>} models - raw entries from OpenRouter's /models
 * @param {Array<{id: string, role: 'representative'|'judge'}>} agents - in
 *        assignment order
 * @param {{includeZeroPrice?: boolean}} [options] - includeZeroPrice:false
 *        skips advertised-$0 models, for a real run on an account that cannot
 *        call the free tier (D-012)
 * @returns {{ok: true, map: Record<string, object>}
 *          | {ok: false, agentId: string | null, reason: string}}
 *          map values have the shape selectCheapestModel returns
 */
export function buildModelMap(models, agents, { includeZeroPrice = true } = {}) {
  if (!Array.isArray(models)) {
    return { ok: false, agentId: null, reason: 'model list was not an array' };
  }
  if (!Array.isArray(agents)) {
    return { ok: false, agentId: null, reason: 'agent list was not an array' };
  }

  // Cheapest first, larger context second — identical order to
  // selectCheapestModel, applied once to the whole pool.
  const pool = models
    .map(normalizeModel)
    .filter((m) => m !== null && (includeZeroPrice || m.totalPrice > 0))
    .sort((a, b) => {
      if (a.totalPrice !== b.totalPrice) return a.totalPrice - b.totalPrice;
      return b.contextLength - a.contextLength;
    });

  const map = {};
  const taken = new Set();

  for (const agent of agents) {
    const floor = ROLE_CONTEXT_FLOOR[agent.role];
    if (floor === undefined) {
      return {
        ok: false,
        agentId: agent.id,
        reason: `unknown agent role ${JSON.stringify(agent.role)}`,
      };
    }

    const pick = pool.find((m) => !taken.has(m.id) && m.contextLength >= floor);
    if (!pick) {
      const priceClause = includeZeroPrice ? '' : 'a non-zero price and ';
      return {
        ok: false,
        agentId: agent.id,
        reason:
          `the live list has no unused model with ${priceClause}at least ` +
          `${floor} tokens of context for ${agent.id}`,
      };
    }

    taken.add(pick.id);
    map[agent.id] = pick;
  }

  return { ok: true, map };
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
