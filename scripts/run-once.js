// One tribunal run, end to end: read config, fetch the live model list,
// resolve the model(s), run the pipeline, hand back everything the caller
// needs to report and persist. scripts/demo.js (CLI) and scripts/server.js
// (web UI) both go through here so the sequence — and the model-resolution
// glue around it — exists in exactly one place.
//
// Nothing here estimates a number the recorder did not produce. The charge
// sheet is read at this edge and passed in as a plain string; D-001 keeps
// fixtures/ out of src/, and this file is in scripts/, not src/.
//
// Errors are returned as { ok: false, reason }, never process.exit — a server
// has to survive a run that could not start.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadConfig } from '../src/config.js';
import { fetchModelList as liveFetchModelList } from '../src/model-client.js';
import { buildModelMap, selectCheapestModel } from '../src/model-select.js';
import { JUDGES, REPRESENTATIVES } from '../src/personas.js';
import { BudgetGate } from '../src/budget.js';
import { ProtocolRecorder } from '../src/protocol.js';
import { runTribunal } from '../src/pipeline.js';
import { DB_PATH, initDb, saveRun } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
export const FIXTURE_PATH = path.join(REPO_ROOT, 'fixtures', 'case-t001.md');

// Assignment order for Mode B: representatives then judges, personas.js order.
// The earliest agent gets the cheapest model (buildModelMap).
export const MODE_B_AGENTS = [
  ...REPRESENTATIVES.map((r) => ({ id: r.id, role: 'representative' })),
  ...JUDGES.map((j) => ({ id: j.id, role: 'judge' })),
];

export function readChargeSheet(fixturePath = FIXTURE_PATH) {
  const raw = readFileSync(fixturePath, 'utf8');
  // The fixture carries a developer-facing preamble above the first `---`
  // (D-001's reminder that nothing in src/ may import it). The charge sheet
  // itself — what a user would type into a text field — is everything after
  // that rule.
  const marker = '\n---\n';
  const cut = raw.indexOf(marker);
  return cut === -1 ? raw.trim() : raw.slice(cut + marker.length).trim();
}

// --- model resolution -----------------------------------------------------

export function resolveModeA(models, { demoModelId = process.env.DEMO_MODEL_ID } = {}) {
  const override = (demoModelId || '').trim();
  if (override) {
    const model = findLiveModel(models, override);
    if (!model) {
      return {
        ok: false,
        reason:
          `DEMO_MODEL_ID is ${JSON.stringify(override)}, but no model with that id, ` +
          `a usable price and a context length is in the live OpenRouter list.`,
      };
    }
    return { ok: true, model, modelSource: 'DEMO_MODEL_ID' };
  }

  const selection = selectCheapestModel(models);
  if (!selection.ok) {
    return { ok: false, reason: `model selection failed: ${selection.reason}` };
  }
  return {
    ok: true,
    model: selection.model,
    modelSource: 'live-cheapest',
    candidates: selection.candidates,
  };
}

export function resolveModeB(models, { skipFree = false } = {}) {
  const result = buildModelMap(models, MODE_B_AGENTS, { includeZeroPrice: !skipFree });
  if (!result.ok) {
    return { ok: false, reason: `no suitable model for ${result.agentId} — ${result.reason}` };
  }
  return {
    ok: true,
    map: result.map,
    modelByAgent: Object.fromEntries(MODE_B_AGENTS.map((a) => [a.id, result.map[a.id].id])),
    modelSource: skipFree ? 'live-map --skip-free' : 'live-map',
  };
}

// Resolve a caller-supplied model id against the live list. Same shape
// selectCheapestModel returns, so downstream reporting uses OpenRouter's
// numbers, not a value typed on a command line. null if absent or unusable.
function findLiveModel(models, id) {
  const raw = models.find((m) => m?.id === id);
  if (!raw) return null;
  const promptPrice = Number(raw.pricing?.prompt);
  const completionPrice = Number(raw.pricing?.completion);
  const contextLength = Number(raw.context_length);
  const usable = [promptPrice, completionPrice, contextLength].every(
    (n) => Number.isFinite(n) && n >= 0,
  );
  if (!usable) return null;
  return {
    id: raw.id,
    promptPrice,
    completionPrice,
    totalPrice: promptPrice + completionPrice,
    contextLength,
  };
}

// --- one full run -------------------------------------------------------

/**
 * Run the tribunal once.
 *
 * `onResolved({ runInfo, config })` fires after the model(s) are chosen and
 * before the first call — the CLI uses it to print the Mode B assignments
 * "before any call".
 *
 * `deps` is for tests: inject `fetchModelList` and/or `transport` (and
 * `config`) and no network is touched.
 *
 * @param {{caseText: string, mode: 'a'|'b', skipFree?: boolean,
 *          onResolved?: Function,
 *          deps?: {fetchModelList?: Function, transport?: Function, config?: object}}} args
 * @returns {Promise<{ok: true, report: object, recorder: object, wallClockMs: number,
 *                     runInfo: object, config: object}
 *                  | {ok: false, reason: string}>}
 */
export async function executeRun({ caseText, mode, skipFree = false, onResolved, deps = {} }) {
  const config = deps.config ?? loadConfig();
  if (!config.apiKey && !deps.transport) {
    return { ok: false, reason: 'OPENROUTER_API_KEY is not set' };
  }

  const fetchModels = deps.fetchModelList ?? liveFetchModelList;
  const models = await fetchModels();

  const gate = new BudgetGate(config.budgetUsd);
  const recorder = new ProtocolRecorder();

  let runArgs;
  let runInfo;

  if (mode === 'b') {
    const resolved = resolveModeB(models, { skipFree });
    if (!resolved.ok) return { ok: false, reason: `Mode B: ${resolved.reason}` };
    runArgs = {
      caseText,
      modelByAgent: resolved.modelByAgent,
      gate,
      recorder,
      transport: deps.transport,
    };
    runInfo = { mode: 'B', modelSource: resolved.modelSource, assignments: resolved.map };
  } else {
    const resolved = resolveModeA(models);
    if (!resolved.ok) return { ok: false, reason: `Mode A: ${resolved.reason}` };
    runArgs = { caseText, modelId: resolved.model.id, gate, recorder, transport: deps.transport };
    runInfo = { mode: 'A', modelSource: resolved.modelSource, selection: resolved.model };
  }

  if (onResolved) onResolved({ runInfo, config });

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const report = await runTribunal(runArgs);
  const wallClockMs = Date.now() - startedAtMs;

  return { ok: true, report, recorder, wallClockMs, runInfo, config, startedAt };
}

// --- persistence (spec.md §6: every completed run is persisted and listable) --
// The one place a finished run is written. The web server holds its own open
// database handle and passes it in as `db`; the CLI lets this open and close
// one. Either way the actual insert is scripts/db.js's saveRun — a single
// write path.

export function persistRun({
  config,
  runInfo,
  caseText,
  report,
  recorder,
  startedAt,
  wallClockMs,
  db,
  dbPath,
}) {
  const handle = db ?? initDb(dbPath ?? DB_PATH);
  try {
    return saveRun(handle, { config, runInfo, caseText, report, recorder, startedAt, wallClockMs });
  } finally {
    if (!db) handle.close();
  }
}
