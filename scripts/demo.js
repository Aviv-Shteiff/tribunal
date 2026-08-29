#!/usr/bin/env node
// Real-run CLI for the tribunal, against fixtures/case-t001.md.
//
//   npm run demo                     Mode A — all seven agents on one model
//   npm run demo -- --mode=b         Mode B — each agent on its own model
//   npm run demo -- --mode=b --skip-free
//
// This is a manual step, not part of `npm test` — it makes real, billed calls
// to OpenRouter. The orchestration (config, live model list, model resolution,
// pipeline, run record) lives in scripts/run-once.js and is shared with the
// web UI (scripts/server.js); this file is the command-line front end.

import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  MODE_B_AGENTS,
  executeRun,
  persistRun,
  readChargeSheet,
} from './run-once.js';

async function main() {
  const { mode, skipFree } = parseArgs(process.argv.slice(2));
  const caseText = readChargeSheet();

  console.log('Fetching the live OpenRouter model list...');
  const result = await executeRun({
    caseText,
    mode,
    skipFree,
    onResolved: ({ runInfo, config }) => {
      if (runInfo.mode === 'B') printAssignments(runInfo.assignments);
      console.log(`Running the tribunal (Mode ${runInfo.mode}, cap $${config.budgetUsd.toFixed(2)})...`);
    },
  });
  if (!result.ok) fail(result.reason);

  const { report, recorder, wallClockMs, runInfo, config, startedAt } = result;
  printReport(report, wallClockMs);
  const runId = persistRun({
    config,
    runInfo,
    caseText,
    report,
    recorder,
    startedAt,
    wallClockMs,
  });
  console.log(`\nSaved as run #${runId} in the database.`);
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

function fail(message) {
  console.error(`demo: ${message}`);
  process.exit(1);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error('demo: unhandled error:', err);
    process.exit(1);
  });
}
