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

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadConfig } from '../src/config.js';
import { fetchModelList as liveFetchModelList } from '../src/model-client.js';
import { buildModelMap, selectCheapestModel } from '../src/model-select.js';
import { JUDGES, REPRESENTATIVES } from '../src/personas.js';
import { BudgetGate } from '../src/budget.js';
import { ProtocolRecorder } from '../src/protocol.js';
import { runTribunal } from '../src/pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
export const FIXTURE_PATH = path.join(REPO_ROOT, 'fixtures', 'case-t001.md');
const RUNS_DIR = path.join(REPO_ROOT, 'runs');

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

  const startedAt = Date.now();
  const report = await runTribunal(runArgs);
  const wallClockMs = Date.now() - startedAt;

  return { ok: true, report, recorder, wallClockMs, runInfo, config };
}

// --- persistence (spec.md §6: every completed run is persisted) ----------

export function writeRunRecord({ config, runInfo, caseText, report, recorder, wallClockMs }) {
  mkdirSync(RUNS_DIR, { recursive: true });
  const timestamp = new Date().toISOString();
  const runFile = path.join(RUNS_DIR, `run-${timestamp.replace(/[:.]/g, '-')}.json`);

  const modelFields =
    runInfo.mode === 'B'
      ? { modelByAgent: report.modelByAgent, modelAssignments: runInfo.assignments }
      : { modelId: runInfo.selection.id, modelSelection: runInfo.selection };

  writeFileSync(
    runFile,
    JSON.stringify(
      {
        timestamp,
        mode: runInfo.mode,
        modelSource: runInfo.modelSource,
        ...modelFields,
        budgetUsd: config.budgetUsd,
        caseText,
        speeches: report.speeches,
        verdicts: report.verdicts,
        representatives: {
          completed: report.representatives.completedAgents,
          failed: report.representatives.failedAgents,
          notAttempted: report.representatives.notAttemptedAgents,
          stopped: report.representatives.stopped,
          stopReason: report.representatives.stopReason,
        },
        judges: {
          completed: report.judges.completedAgents,
          failed: report.judges.failedAgents,
          notAttempted: report.judges.notAttemptedAgents,
          stopped: report.judges.stopped,
          stopReason: report.judges.stopReason,
        },
        totals: report.totals,
        wallClockMs,
        // The full protocol (spec.md §6): one record per model call, in call
        // order, straight from the recorder — not reconstructed.
        protocol: recorder.records,
      },
      null,
      2,
    ),
  );
  return runFile;
}
