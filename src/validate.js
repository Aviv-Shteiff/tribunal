// Output contract enforcement (spec.md §5). The shape is checked in code, not
// requested in a prompt. Nothing here throws: a bad response is a handled case.

export const VERDICTS = Object.freeze(['justified', 'not justified']);
export const SEATS = Object.freeze(['defense', 'prosecution']);

const FENCE = /^\s*```(?:[A-Za-z0-9_-]*)?\s*\n([\s\S]*?)\n?\s*```\s*$/;

/** Remove a single wrapping code fence, if the whole string is one. */
export function stripFences(raw) {
  if (typeof raw !== 'string') return '';
  const match = FENCE.exec(raw);
  return (match ? match[1] : raw).trim();
}

export function validateRepresentative(raw) {
  return validate(raw, [
    ['agent_id', nonEmptyString],
    ['seat', oneOf(SEATS)],
    ['speech', nonEmptyString],
    ['key_points', stringArray],
  ]);
}

export function validateJudge(raw) {
  return validate(raw, [
    ['judge_id', nonEmptyString],
    ['verdict', oneOf(VERDICTS)],
    ['reasoning', nonEmptyString],
    ['key_factors', stringArray],
  ]);
}

function validate(raw, fields) {
  const text = stripFences(raw);
  if (text === '') return fail('response was empty');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return fail(`response was not valid JSON: ${err.message}`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('response was not a JSON object');
  }

  const value = {};
  for (const [key, check] of fields) {
    const problem = check(parsed[key], key);
    if (problem) return fail(problem);
    value[key] = parsed[key];
  }
  // Only contract fields survive; anything extra the model volunteered is dropped.
  return { ok: true, value: Object.freeze(value) };
}

function fail(error) {
  return { ok: false, error };
}

function nonEmptyString(value, key) {
  if (typeof value !== 'string') return `"${key}" must be a string`;
  if (value.trim() === '') return `"${key}" must not be empty`;
  return null;
}

function oneOf(allowed) {
  return (value, key) => {
    if (typeof value !== 'string') return `"${key}" must be a string`;
    if (!allowed.includes(value)) {
      return `"${key}" must be exactly one of ${allowed.map((a) => `"${a}"`).join(' or ')}, got ${JSON.stringify(value)}`;
    }
    return null;
  };
}

function stringArray(value, key) {
  if (!Array.isArray(value)) return `"${key}" must be an array`;
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') {
      return `"${key}" must contain only non-empty strings`;
    }
  }
  return null;
}
