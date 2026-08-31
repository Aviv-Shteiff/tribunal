#!/usr/bin/env node
// Minimal web UI over the pipeline. No framework, no new dependency: node:http
// serves the pages and the endpoints. Binds 0.0.0.0 on process.env.PORT (3000
// locally) so it runs both on localhost and on a host like Render. spec.md §8
// excludes auth; see decisions.md D-016 for the risks of a public instance.
//
// POST /run goes through the SAME executeRun() the CLI uses
// (scripts/run-once.js) — no pipeline logic is duplicated, and a request runs
// the pipeline exactly once (input validation is plain string/enum checks, no
// dry run). One run at a time: a second POST /run while one is in flight gets
// 409. A completed run is written to the SQLite store (scripts/db.js) via the
// single persistRun path; there is no runs/*.json anymore.
//
// GET /past + GET /runs + GET /runs/:id are the read-only "past runs" view:
// they read from the database, never from a fresh pipeline call.
//
// A run is a minute or two of real, paid model calls. If the browser goes away
// mid-run the calls still finish server-side — closing the tab does not stop
// the run or save cost. The budget gate (spec.md §6) is the only cost control.
// See decisions.md D-013 / D-014.

import { createServer as httpCreateServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { executeRun, persistRun, readChargeSheet } from './run-once.js';
import { getRun, initDb, listRuns } from './db.js';
import { REPRESENTATIVES } from '../src/personas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_BODY_BYTES = 1_000_000;
const RUN_DETAIL_RE = /^\/runs\/(\d+)$/;

/**
 * @param {{fetchModelList?: Function, transport?: Function, config?: object,
 *          persist?: boolean, db?: object, dbPath?: string}} [deps]
 */
export function createServer(deps = {}) {
  // Opened on first use so a route that never touches the store (GET /, the
  // static assets) needs no database, and tests that pass no `db` never open
  // the real file.
  let db = deps.db ?? null;
  const store = () => (db ??= initDb(deps.dbPath));
  let running = false;

  return httpCreateServer(async (req, res) => {
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        return servePage(res, 'index.html', { chargeSheet: true });
      }
      if (req.method === 'GET' && req.url === '/past') {
        return servePage(res, 'runs.html');
      }
      if (req.method === 'GET' && req.url === '/render.js') {
        return serveFile(res, 'render.js', 'text/javascript; charset=utf-8');
      }
      if (req.method === 'GET' && req.url === '/style.css') {
        return serveFile(res, 'style.css', 'text/css; charset=utf-8');
      }
      if (req.method === 'GET' && req.url === '/runs') {
        return sendJson(res, 200, { ok: true, runs: listRuns(store()) });
      }
      const detailMatch = req.method === 'GET' && RUN_DETAIL_RE.exec(req.url ?? '');
      if (detailMatch) {
        const run = getRun(store(), Number(detailMatch[1]));
        return run
          ? sendJson(res, 200, run)
          : sendJson(res, 404, { ok: false, error: 'no such run' });
      }
      if (req.method === 'POST' && req.url === '/run') {
        if (running) {
          return sendJson(res, 409, { ok: false, error: 'a run is already in progress' });
        }
        running = true;
        try {
          return await handleRun(req, res, deps, store);
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

function servePage(res, file, { chargeSheet = false } = {}) {
  let html = readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
  if (chargeSheet) html = html.replace('{{CHARGE_SHEET}}', escapeHtml(readChargeSheet()));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function serveFile(res, file, contentType) {
  res.writeHead(200, { 'content-type': contentType });
  res.end(readFileSync(path.join(PUBLIC_DIR, file), 'utf8'));
}

async function handleRun(req, res, deps, store) {
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

  const { report, recorder, wallClockMs, runInfo, config, startedAt } = result;

  // Persist the completed run (spec.md §6). A write failure must not swallow a
  // finished run's result. Tests pass persist:false so `npm test` does not
  // write to the real database.
  let runId = null;
  if (deps.persist !== false) {
    try {
      runId = persistRun({
        config, runInfo, caseText, report, recorder, startedAt, wallClockMs,
        db: store(),
      });
    } catch (err) {
      console.error('server: run not saved:', err.message);
    }
  }

  return sendJson(res, 200, shapeResult(report, wallClockMs, runInfo, runId));
}

// Everything below comes straight from the report / recorder. Nothing computed.
function shapeResult(report, wallClockMs, runInfo, runId) {
  const repStatus = (id) =>
    report.representatives.completedAgents.includes(id)
      ? 'ok'
      : report.representatives.failedAgents.includes(id)
        ? 'failed'
        : 'not attempted';

  // report.speeches holds only the representatives that produced a valid one;
  // a failed or not-attempted representative has no speech (turn 6 addition —
  // see decisions.md D-013).
  const speechFor = new Map(report.speeches.map((s) => [s.agentId, s.speech]));

  return {
    ok: true,
    runId,
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
  createServer().listen(port, '0.0.0.0', () => {
    console.log(`Tribunal UI on http://localhost:${port}  (Ctrl+C to stop)`);
  });
}
