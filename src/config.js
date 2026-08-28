// Runtime configuration, read from the environment. No config file format.

const DEFAULT_BUDGET_USD = 5.0; // spec.md §2

export function loadConfig(env = process.env) {
  return {
    apiKey: env.OPENROUTER_API_KEY || null,
    budgetUsd: readBudget(env.RUN_BUDGET_USD),
  };
}

function readBudget(raw) {
  if (raw === undefined || raw === '') return DEFAULT_BUDGET_USD;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`RUN_BUDGET_USD must be a non-negative number, got ${JSON.stringify(raw)}`);
  }
  return value;
}
