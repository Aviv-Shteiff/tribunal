// The single path to OpenRouter. Every model call in this project goes through
// callModel; no other module may issue HTTP to a model provider (CLAUDE.md).
// fetchModelList lives here too, for the same reason — it is the only other
// OpenRouter endpoint this project touches, and this is the one file allowed
// to call fetch() against openrouter.ai.

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const REQUEST_TIMEOUT_MS = 60_000;

export class ModelCallError extends Error {
  constructor(message, { durationMs, cause } = {}) {
    super(message, { cause });
    this.name = 'ModelCallError';
    this.durationMs = durationMs ?? 0;
  }
}

/**
 * One model call. Returns the response text plus the usage the API reported.
 * Token counts and cost are taken from the response verbatim; only durationMs
 * is measured locally. A missing cost stays null — it is never estimated
 * (spec.md §6).
 *
 * maxTokens, when given, caps the completion — the pipeline sets it on
 * representative calls (spec.md §5, D-010) and leaves judge calls uncapped.
 *
 * Throws ModelCallError on a transport, HTTP or envelope failure. Callers that
 * must not throw wrap this via retry.js.
 */
export async function callModel({
  modelId,
  systemPrompt,
  userMessage,
  maxTokens,
  transport = openRouterTransport,
}) {
  const body = {
    model: modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    usage: { include: true },
  };
  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    body.max_tokens = maxTokens;
  }

  const startedAt = Date.now();
  let response;
  try {
    response = await transport(body);
  } catch (err) {
    throw new ModelCallError(`model call failed: ${err.message}`, {
      durationMs: Date.now() - startedAt,
      cause: err,
    });
  }
  const durationMs = Date.now() - startedAt;

  if (response?.error) {
    const detail = response.error.message ?? JSON.stringify(response.error);
    throw new ModelCallError(`model returned an error: ${detail}`, { durationMs });
  }

  const choice = response?.choices?.[0];
  if (!choice) {
    throw new ModelCallError('model response contained no choices', { durationMs });
  }

  const usage = response.usage ?? {};
  return {
    text: choice.message?.content ?? '',
    promptTokens: numberOrNull(usage.prompt_tokens),
    completionTokens: numberOrNull(usage.completion_tokens),
    cost: numberOrNull(usage.cost),
    durationMs,
  };
}

/** The real HTTP transport. Swapped for a fake in tests. */
export async function openRouterTransport(body, { apiKey = process.env.OPENROUTER_API_KEY } = {}) {
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  const res = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * The live OpenRouter model list (spec.md §4 — "the available list is fetched
 * from OpenRouter at startup and filtered"). Public endpoint, no API key.
 * Returns the raw array of listed models; filtering and selection is
 * model-select.js's job, kept separate so it can be tested without a fetch.
 */
export async function fetchModelList({ transport = openRouterModelsTransport } = {}) {
  const response = await transport();
  if (!response || !Array.isArray(response.data)) {
    throw new Error('OpenRouter model list response did not contain a data array');
  }
  return response.data;
}

async function openRouterModelsTransport() {
  const res = await fetch(OPENROUTER_MODELS_URL, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
