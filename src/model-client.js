// The single path to OpenRouter. Every model call in this project goes through
// callModel; no other module may issue HTTP to a model provider (CLAUDE.md).

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
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
 * Throws ModelCallError on a transport, HTTP or envelope failure. Callers that
 * must not throw wrap this via retry.js.
 */
export async function callModel({
  modelId,
  systemPrompt,
  userMessage,
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

  const res = await fetch(OPENROUTER_URL, {
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

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
