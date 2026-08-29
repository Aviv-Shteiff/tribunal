#!/usr/bin/env node
// Minimal local web UI over the pipeline (turn 5). No framework, no new
// dependency: node:http serves one page and one endpoint. Bound to
// 127.0.0.1 — spec.md §8 excludes auth and this is local use only.
//
// POST /run goes through the SAME executeRun() the CLI uses
// (scripts/run-once.js) — no pipeline logic is duplicated, and a request runs
// the pipeline exactly once (input validation is plain string/enum checks, no
// dry run). One run at a time: a second POST /run while one is in flight gets
// 409.
//
// A run is a minute or two of real, paid model calls. If the browser goes away
// mid-run the calls still finish server-side — closing the tab does not stop
// the run or save cost. The budget gate (spec.md §6) is the only cost control.
// See decisions.md D-013.

import { createServer as httpCreateServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { executeRun, readChargeSheet, writeRunRecord } from './run-once.js';
import { REPRESENTATIVES } from '../src/personas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = path.join(__dirname, '..', 'public', 'index.html');
const MAX_BODY_BYTES = 1_000_000;

/**
 * @param {{fetchModelList?: Function, transport?: Function, config?: object}} [deps]
 *        test hooks passed straight through to executeRun
 */
export function createServer(deps = {}) {
  let running = false;

  return httpCreateServer(async (req, res) => {
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        return servePage(res);
      }
      if (req.method === 'POST' && req.url === '/run') {
        if (running) {
          return sendJson(res, 409, { ok: false, error: 'a run is already in progress' });
        }
        running = true;
        try {
          return await handleRun(req, res, deps);
        } finally {
          running = false;
        }
      }
      return sendJson(res, 404, { ok: false, error: 'not found' });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: String(err?.message ?? err) });
    }
  });
}

function servePage(res) {
  const html = readFileSync(PAGE_PATH, 'utf8').replace(
    '{{CHARGE_SHEET}}',
    escapeHtml(readChargeSheet()),
  );
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function handleRun(req, res, deps) {
  let parsed;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: `request body: ${err.message}` });
  }

  const caseText = typeof parsed.caseText === 'string' ? parsed.caseText.trim() : '';
  const mode = parsed.mode === 'a' || parsed.mode === 'b' ? parsed.mode : null;
  if (caseText === '') return sendJson(res, 400, { ok: false, error: 'charge sheet was empty' });
  if (mode === null) return sendJson(res, 400, { ok: false, error: 'mode must be "a" or "b"' });

  const result = await executeRun({
    caseText,
    mode,
    skipFree: mode === 'b', // D-012: this account cannot call the free tier
    deps,
  });

  if (!result.ok) {
    // executeRun's own reason, verbatim — no new failure copy invented here.
    return sendJson(res, 502, { ok: false, error: result.reason });
  }

  const { report, recorder, wallClockMs, runInfo, config } = result;

  // Persist the completed run (spec.md §6). No UI listing. A write failure must
  // not swallow a finished run's result. Tests pass persist:false so `npm test`
  // does not litter runs/.
  let runFile = null;
  if (deps.persist !== false) {
    try {
      runFile = writeRunRecord({ config, runInfo, caseText, report, recorder, wallClockMs });
    } catch (err) {
      console.error('server: run record not written:', err.message);
    }
  }

  return sendJson(res, 200, shapeResult(report, wallClockMs, runInfo, runFile));
}

// Everything below comes straight from the report / recorder. Nothing computed.
function shapeResult(report, wallClockMs, runInfo, runFile) {
  const repStatus = (id) =>
    report.representatives.completedAgents.includes(id)
      ? 'ok'
      : report.representatives.failedAgents.includes(id)
        ? 'failed'
        : 'not attempted';

  // report.speeches holds only the representatives that produced a valid one;
  // a failed or not-attempted representative has no speech (turn 6 contract
  // addition — see decisions.md D-013).
  const speechFor = new Map(report.speeches.map((s) => [s.agentId, s.speech]));

  return {
    ok: true,
    mode: runInfo.mode,
    modelSource: runInfo.modelSource,
    representatives: REPRESENTATIVES.map((r) => ({
      agentId: r.id,
      seat: r.seat,
      status: repStatus(r.id),
      speech: speechFor.get(r.id) ?? null,
    })),
    verdicts: report.verdicts.map((v) => ({
      judge_id: v.judge_id,
      verdict: v.verdict,
      reasoning: v.reasoning,
      key_factors: v.key_factors,
    })),
    judges: {
      completed: report.judges.completedAgents,
      failed: report.judges.failedAgents,
      notAttempted: report.judges.notAttemptedAgents,
    },
    totals: report.totals,
    wallClockMs,
    stopped: report.representatives.stopped || report.judges.stopped,
    stopReason: report.representatives.stopReason ?? report.judges.stopReason ?? null,
    runFile: runFile ? path.basename(runFile) : null,
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY_BYTES) reject(new Error('request body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, '127.0.0.1', () => {
    console.log(`Tribunal UI on http://localhost:${port}  (Ctrl+C to stop)`);
  });
}
