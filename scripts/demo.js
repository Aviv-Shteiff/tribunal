#!/usr/bin/env node
// Turn 3 demo: one real run of the full pipeline against fixtures/case-t001.md,
// Mode A (single model, chosen live by price then context — spec.md §4).
//
// Setting DEMO_MODEL_ID pins that model instead of the live cheapest one —
// still resolved against the live list, so the price and context recorded are
// OpenRouter's own numbers. This is the "one model chosen by the user" that
// spec.md §4 Mode A describes; the auto-pick is the fallback when it is unset.
//
// This is a manual step, not part of `npm test` — it makes a real, billed
// call to OpenRouter. `npm run demo` runs it.
//
// The charge sheet is read here, at the edge, and passed into the pipeline
// as a plain string — exactly as a UI's text field would. Nothing in `src/`
// imports fixtures/ (decisions.md D-001); this script is not in `src/`.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadConfig } from '../src/config.js';
import { fetchModelList } from '../src/model-client.js';
import { selectCheapestModel } from '../src/model-select.js';
import { BudgetGate } from '../src/budget.js';
import { ProtocolRecorder } from '../src/protocol.js';
import { runTribunal } from '../src/pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const FIXTURE_PATH = path.join(REPO_ROOT, 'fixtures', 'case-t001.md');
const RUNS_DIR = path.join(REPO_ROOT, 'runs');

async function main() {
  const config = loadConfig();
  if (!config.apiKey) {
    fail('OPENROUTER_API_KEY is not set. Copy .env.example to .env and fill it in.');
  }

  const caseText = readChargeSheet(FIXTURE_PATH);

  console.log('Fetching the live OpenRouter model list...');
  const models = await fetchModelList();

  const override = (process.env.DEMO_MODEL_ID || '').trim();
  let model;
  let modelSource;
  if (override) {
    model = findLiveModel(models, override);
    if (!model) {
      fail(
        `DEMO_MODEL_ID is ${JSON.stringify(override)}, but no model with that id, ` +
          `a usable price and a context length is in the live OpenRouter list.`,
      );
    }
    modelSource = 'DEMO_MODEL_ID';
    console.log(
      `Using DEMO_MODEL_ID override ${model.id} — price $${model.totalPrice}/token ` +
        `total, ${model.contextLength} token context.`,
    );
  } else {
    const selection = selectCheapestModel(models);
    if (!selection.ok) {
      fail(`Model selection failed: ${selection.reason}`);
    }
    model = selection.model;
    modelSource = 'live-cheapest';
    console.log(
      `Selected ${model.id} — price $${model.totalPrice}/token total, ` +
        `${model.contextLength} token context (${selection.candidates} candidates qualified).`,
    );
  }

  const gate = new BudgetGate(config.budgetUsd);
  const recorder = new ProtocolRecorder();

  console.log(`Running the tribunal (Mode A, cap $${config.budgetUsd.toFixed(2)})...`);
  const startedAt = Date.now();
  const report = await runTribunal({ caseText, modelId: model.id, gate, recorder });
  const wallClockMs = Date.now() - startedAt;

  printReport(report, wallClockMs);
  const runFile = writeRunRecord({
    config,
    model,
    modelSource,
    caseText,
    report,
    recorder,
    wallClockMs,
  });
  console.log(`\nFull protocol written to ${path.relative(REPO_ROOT, runFile)}`);
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

function printReport(report, wallClockMs) {
  console.log('\n=== Verdicts ===');
  for (const v of report.verdicts) {
    console.log(`\n[${v.judge_id}] ${v.verdict}`);
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

function writeRunRecord({ config, model, modelSource, caseText, report, recorder, wallClockMs }) {
  mkdirSync(RUNS_DIR, { recursive: true });
  const timestamp = new Date().toISOString();
  const fileName = `run-${timestamp.replace(/[:.]/g, '-')}.json`;
  const runFile = path.join(RUNS_DIR, fileName);

  writeFileSync(
    runFile,
    JSON.stringify(
      {
        timestamp,
        mode: 'A',
        modelId: model.id,
        modelSource,
        modelSelection: model,
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

function fail(message) {
  console.error(`demo: ${message}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('demo: unhandled error:', err);
  process.exit(1);
});
