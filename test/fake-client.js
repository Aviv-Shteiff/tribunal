// Fake OpenRouter transport. Tests never touch the network.

/** Build an OpenRouter-shaped response envelope. */
export function envelope({
  content = '',
  promptTokens = 10,
  completionTokens = 20,
  cost = 0.001,
} = {}) {
  return {
    choices: [{ message: { role: 'assistant', content } }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, cost },
  };
}

/**
 * A transport driven by a script, one entry per expected call:
 *   {content, promptTokens, completionTokens, cost} -> a normal envelope
 *   {throws: 'message'}                             -> a transport failure
 *   {envelope: {...}}                               -> a raw envelope
 * The returned function carries `.calls`, the request bodies it received.
 */
export function fakeTransport(script) {
  let next = 0;
  const transport = async (body) => {
    transport.calls.push(body);
    if (next >= script.length) {
      throw new Error(`fake transport: no scripted response for call ${next + 1}`);
    }
    const step = script[next++];
    if (step.throws) throw new Error(step.throws);
    if (step.envelope) return step.envelope;
    return envelope(step);
  };
  transport.calls = [];
  return transport;
}

export const VALID_REPRESENTATIVE = JSON.stringify({
  agent_id: 'jon_snow',
  seat: 'defense',
  speech: 'He acted to stop a greater harm.',
  key_points: ['imminent threat', 'no alternative'],
});

export const VALID_JUDGE = JSON.stringify({
  judge_id: 'barak',
  verdict: 'not justified',
  reasoning: 'The threat was not imminent on the record before me.',
  key_factors: ['timing', 'availability of alternatives'],
});
