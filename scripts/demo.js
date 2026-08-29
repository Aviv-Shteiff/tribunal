#!/usr/bin/env node
// Real-run CLI for the tribunal, against fixtures/case-t001.md.
//
//   npm run demo                     Mode A — all seven agents on one model
//   npm run demo -- --mode=b         Mode B — each agent on its own model
//   npm run demo -- --mode=b --skip-free
//
// Mode A (spec.md §4): the one model is the live cheapest (price then context),
// or DEMO_MODEL_ID if set — still resolved against the live list so the numbers
// recorded are OpenRouter's own.
//
// Mode B (spec.md §4): each of the seven agents is bound to its own model by
// buildModelMap — cheapest first, never reused, judges held to the 12k context
// floor. --skip-free drops advertised-$0 models from the pool; this account
// cannot call the free tier (decisions.md D-012).
//
// This is a manual step, not part of `npm test` — it makes real, billed calls
// to OpenRouter.
//
// The charge sheet is read here, at the edge, and passed into the pipeline as a
// plain string — exactly as a UI's text field would. Nothing in `src/` imports
// fixtures/ (decisions.md D-001); this script is not in `src/`.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadConfig } from '../src/config.js';
import { fetchModelList } from '../src/model-client.js';
import { buildModelMap, selectCheapestModel } from '../src/model-select.js';
import { JUDGES, REPRESENTATIVES } from '../src/personas.js';
import { BudgetGate } from '../src/budget.js';
import { ProtocolRecorder } from '../src/protocol.js';
import { runTribunal } from '../src/pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const FIXTURE_PATH = path.join(REPO_ROOT, 'fixtures', 'case-t001.md');
const RUNS_DIR = path.join(REPO_ROOT, 'runs');

// Assignment order for Mode B: representatives then judges, personas.js order.
// The earliest agent gets the cheapest model (buildModelMap).
const MODE_B_AGENTS = [
  ...REPRESENTATIVES.map((r) => ({ id: r.id, role: 'representative' })),
  ...JUDGES.map((j) => ({ id: j.id, role: 'judge' })),
];

async function main() {
  const { mode, skipFree } = parseArgs(process.argv.slice(2));

  const config = loadConfig();
  if (!config.apiKey) {
    fail('OPENROUTER_API_KEY is not set. Copy .env.example to .env and fill it in.');
  }

  const caseText = readChargeSheet(FIXTURE_PATH);

  console.log('Fetching the live OpenRouter model list...');
  const models = await fetchModelList();

  const gate = new BudgetGate(config.budgetUsd);
  const recorder = new ProtocolRecorder();

  let runArgs;
  let runInfo;

  if (mode === 'b') {
    const map = resolveModeB(models, { skipFree });
    printAssignments(map);
    runArgs = {
      caseText,
      modelByAgent: Object.fromEntries(MODE_B_AGENTS.map((a) => [a.id, map[a.id].id])),
      gate,
      recorder,
    };
    runInfo = {
      mode: 'B',
      modelSource: skipFree ? 'live-map --skip-free' : 'live-map',
      assignments: map,
    };
    console.log(`\nRunning the tribunal (Mode B, cap $${config.budgetUsd.toFixed(2)})...`);
  } else {
    const { model, modelSource } = resolveModeA(models);
    runArgs = { caseText, modelId: model.id, gate, recorder };
    runInfo = { mode: 'A', modelSource, selection: model };
    console.log(`Running the tribunal (Mode A, cap $${config.budgetUsd.toFixed(2)})...`);
  }

  const startedAt = Date.now();
  const report = await runTribunal(runArgs);
  const wallClockMs = Date.now() - startedAt;

  printReport(report, wallClockMs);
  const runFile = writeRunRecord({ config, runInfo, caseText, report, recorder, wallClockMs });
  console.log(`\nFull protocol written to ${path.relative(REPO_ROOT, runFile)}`);
}

function parseArgs(argv) {
  const opts = { mode: 'a', skipFree: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--skip-free') opts.skipFree = true;
    else if (arg.startsWith('--mode=')) opts.mode = arg.slice('--mode='.length).toLowerCase();
    else if (arg === '--mode') opts.mode = String(argv[(i += 1)]).toLowerCase();
    else fail(`unknown argument ${JSON.stringify(arg)}`);
  }
  if (opts.mode !== 'a' && opts.mode !== 'b') {
    fail(`--mode must be "a" or "b", got ${JSON.stringify(opts.mode)}`);
  }
  if (opts.skipFree && opts.mode !== 'b') {
    fail('--skip-free only applies to --mode=b');
  }
  return opts;
}

function readChargeSheet(fixturePath) {
  const raw = readFileSync(fixturePath, 'utf8');
  // The fixture carries a developer-facing preamble above the first `---`
  // (D-001's own reminder that nothing in src/ may import it). The charge
  // sheet itself — what a user would type into a text field — is everything
  // after that rule.
  const marker = '\n---\n';
  const cut = raw.indexOf(marker);
  return cut === -1 ? raw.trim() : raw.slice(cut + marker.length).trim();
}

// --- Mode A model resolution ---

function resolveModeA(models) {
  const override = (process.env.DEMO_MODEL_ID || '').trim();
  if (override) {
    const model = findLiveModel(models, override);
    if (!model) {
      fail(
        `DEMO_MODEL_ID is ${JSON.stringify(override)}, but no model with that id, ` +
          `a usable price and a context length is in the live OpenRouter list.`,
      );
    }
    console.log(
      `Using DEMO_MODEL_ID override ${model.id} — price $${model.totalPrice}/token ` +
        `total, ${model.contextLength} token context.`,
    );
    return { model, modelSource: 'DEMO_MODEL_ID' };
  }

  const selection = selectCheapestModel(models);
  if (!selection.ok) {
    fail(`Model selection failed: ${selection.reason}`);
  }
  console.log(
    `Selected ${selection.model.id} — price $${selection.model.totalPrice}/token total, ` +
      `${selection.model.contextLength} token context (${selection.candidates} candidates qualified).`,
  );
  return { model: selection.model, modelSource: 'live-cheapest' };
}

// Resolve a caller-supplied model id against the live list. Returns the same
// shape selectCheapestModel does, so everything downstream — the log line, the
// run record — reports OpenRouter's numbers, not a value typed on the command
// line. null if the id is absent or its price/context is unusable.
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

// --- Mode B model resolution ---

function resolveModeB(models, { skipFree }) {
  const result = buildModelMap(models, MODE_B_AGENTS, { includeZeroPrice: !skipFree });
  if (!result.ok) {
    fail(`Mode B: no suitable model for ${result.agentId} — ${result.reason}`);
  }
  return result.map;
}

function printAssignments(map) {
  console.log('\n=== Mode B model assignments (before any call) ===');
  for (const agent of MODE_B_AGENTS) {
    const m = map[agent.id];
    console.log(
      `  ${agent.id.padEnd(20)} ${agent.role.padEnd(15)} ${m.id}  ` +
        `($${m.totalPrice}/token total, ${m.contextLength} ctx)`,
    );
  }
}

// --- Reporting ---

function printReport(report, wallClockMs) {
  const byAgent = report.modelByAgent;

  console.log('\n=== Verdicts ===');
  for (const v of report.verdicts) {
    const tag = byAgent ? `${v.judge_id} @ ${byAgent[v.judge_id]}` : v.judge_id;
    console.log(`\n[${tag}] ${v.verdict}`);
    console.log(v.reasoning);
    console.log(`Key factors: ${v.key_factors.join('; ')}`);
  }
  if (report.verdicts.length < 3) {
    console.log(
      `\n(${report.verdicts.length} of 3 judges produced a valid verdict; ` +
        `${report.judges.failedAgents.length} failed, ` +
        `${report.judges.notAttemptedAgents.length} not attempted.)`,
    );
  }

  console.log('\n=== Run summary ===');
  console.log(`Speeches: ${report.speeches.length} of 4`);
  console.log(`Verdicts: ${report.verdicts.length} of 3`);
  console.log(`Calls: ${report.totals.calls}`);
  console.log(`Prompt tokens: ${report.totals.promptTokens}`);
  console.log(`Completion tokens: ${report.totals.completionTokens}`);
  console.log(`Total tokens: ${report.totals.totalTokens}`);
  console.log(`Cost: $${report.totals.costUsd.toFixed(6)}`);
  if (report.totals.callsWithUnknownCost > 0) {
    console.log(`(${report.totals.callsWithUnknownCost} call(s) reported no cost)`);
  }
  console.log(`Recorded call duration (sum): ${report.totals.durationMs} ms`);
  console.log(`Wall-clock duration (this run): ${wallClockMs} ms`);
  if (report.representatives.stopped || report.judges.stopped) {
    console.log(`Budget stop: ${report.representatives.stopReason ?? report.judges.stopReason}`);
  }
}

function writeRunRecord({ config, runInfo, caseText, report, recorder, wallClockMs }) {
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
        // order, straight from the recorder — not reconstructed. Each record
        // carries the model id that actually served that call.
        protocol: recorder.records,
      },
      null,
      2,
    ),
  );
  return runFile;
}

function fail(message) {
  console.error(`demo: ${message}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('demo: unhandled error:', err);
  process.exit(1);
});
