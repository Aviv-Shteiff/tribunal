// Shared rendering for the run pages. index.html uses it for a fresh run's
// result; runs.html uses it for a stored run's detail. Both feed showResults()
// the same shape (the POST /run response / db.getRun output), so the detail
// view of a past run looks exactly like the live view of a new one.
//
// Loaded as a classic script by both pages — these are plain globals.

const $ = (id) => document.getElementById(id);

function showError(msg) {
  $('error').hidden = false;
  $('error').textContent = msg;
}

// --- minimal markdown: the subset the real runs actually produce ---
// bold **x**, italic *x*, ATX headers, blank-line paragraphs (real or the
// literal two-char "\n" some models emit), and tight numbered lists.
function renderMarkdown(src) {
  const escHtml = (s) =>
    s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const inline = (s) =>
    escHtml(s)
      .replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');

  const text = String(src == null ? '' : src).replace(/\\r\\n|\\n|\r\n|\r/g, '\n');
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);

  return blocks
    .map((block) => {
      const lines = block.split('\n');
      if (lines.length === 1 && /^#{1,6}\s+\S/.test(lines[0])) {
        return '<h4>' + inline(lines[0].replace(/^#{1,6}\s+/, '')) + '</h4>';
      }
      if (lines.length > 1 && lines.every((l) => /^\s*\d+[.)]\s+\S/.test(l))) {
        return (
          '<ol>' +
          lines.map((l) => '<li>' + inline(l.replace(/^\s*\d+[.)]\s+/, '')) + '</li>').join('') +
          '</ol>'
        );
      }
      return '<p>' + lines.map(inline).join('<br>') + '</p>';
    })
    .join('');
}

function mdBlock(text) {
  const div = document.createElement('div');
  div.className = 'md';
  div.innerHTML = renderMarkdown(text); // text is escaped inside renderMarkdown
  return div;
}

// A collapsible <details> with an uppercase summary and rendered body.
function collapsible({ summaryText, body, className }) {
  const wrap = document.createElement('div');
  wrap.className = className;

  const head = document.createElement('div');
  head.className = 'chead';
  head.textContent = summaryText.head;
  wrap.appendChild(head);

  const det = document.createElement('details');
  const sum = document.createElement('summary');
  sum.textContent = summaryText.toggle;
  det.append(sum, mdBlock(body));
  wrap.appendChild(det);

  return wrap;
}

// The signature element: a stamped adjudication mark, judge id + verdict,
// bordered and slightly rotated, in the verdict's colour.
function verdictStamp(v) {
  const stamp = document.createElement('div');
  stamp.className = 'stamp ' + (v.verdict === 'justified' ? 'stamp--justified' : 'stamp--not-justified');
  const rot = -1 - Math.random(); // [-2deg, -1deg], hand-stamped, never parallel
  stamp.style.setProperty('--rot', rot.toFixed(2) + 'deg');

  const judge = document.createElement('span');
  judge.className = 'stamp__judge';
  judge.textContent = v.judge_id;

  const verdict = document.createElement('span');
  verdict.className = 'stamp__verdict';
  verdict.textContent = v.verdict;

  stamp.append(judge, verdict);
  return stamp;
}

function fillDl(dl, rows) {
  dl.replaceChildren();
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = String(v);
    dl.append(dt, dd);
  }
}

function showResults(d) {
  $('results').hidden = false;

  // --- docket header (once a case has an id) ---
  const dk = $('docket');
  if (dk) {
    dk.replaceChildren();
    if (d.runId != null) {
      const no = document.createElement('span');
      no.className = 'docket-no';
      no.textContent = '№ ' + String(d.runId).padStart(3, '0');
      const meta = document.createElement('span');
      meta.className = 'docket-meta';
      const when = d.startedAt ? new Date(d.startedAt).toLocaleDateString() : '';
      meta.textContent = ['Mode ' + d.mode, when].filter(Boolean).join('  ·  ');
      dk.append(no, meta);
      dk.hidden = false;
    } else {
      dk.hidden = true;
    }
  }

  // --- verdict-count note when fewer than three judges returned ---
  const note = $('verdict-note');
  if (d.verdicts.length < 3) {
    const failed = d.judges.failed;
    note.textContent =
      d.verdicts.length + ' of 3 judges returned a verdict — ' +
      failed.length + ' failed, ' + d.judges.notAttempted.length + ' not attempted' +
      (failed.length ? ' (' + failed.join(', ') + ')' : '') + '.';
    note.hidden = false;
  } else {
    note.hidden = true;
    note.textContent = '';
  }

  // --- verdicts: three stamps in a row, then per-judge opinions ---
  const vc = $('verdicts');
  vc.replaceChildren();
  if (d.verdicts.length === 0) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'No judge produced a valid verdict.';
    vc.appendChild(p);
  } else {
    const row = document.createElement('div');
    row.className = 'stamp-row';
    for (const v of d.verdicts) row.appendChild(verdictStamp(v));
    vc.appendChild(row);

    for (const v of d.verdicts) {
      const det = document.createElement('details');
      det.className = 'opinion';
      const sum = document.createElement('summary');
      sum.textContent = v.judge_id + '  ·  opinion';
      det.append(sum, mdBlock(v.reasoning));
      vc.appendChild(det);
    }
  }

  // --- representative register ---
  const tb = $('reps').querySelector('tbody');
  tb.replaceChildren();
  for (const rep of d.representatives) {
    const cls = rep.status === 'ok' ? 'ok' : rep.status === 'failed' ? 'failed' : 'na';
    const tr = document.createElement('tr');
    for (const text of [rep.agentId, rep.seat]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    const td = document.createElement('td');
    const span = document.createElement('span');
    span.className = 'badge ' + cls;
    span.textContent = rep.status;
    td.appendChild(span);
    tr.appendChild(td);
    tb.appendChild(tr);
  }

  // --- speeches: one collapsible per representative that produced one ---
  const sc = $('speeches');
  sc.replaceChildren();
  for (const rep of d.representatives) {
    if (typeof rep.speech === 'string' && rep.speech.trim() !== '') {
      sc.appendChild(collapsible({
        summaryText: { head: rep.agentId + '  ·  ' + rep.seat, toggle: 'Show speech' },
        body: rep.speech,
        className: 'speech',
      }));
    }
  }

  // --- run summary, tier 1: what a first-time viewer needs ---
  fillDl($('summary-basic'), [
    ['Mode', d.mode],
    ['Verdicts returned', d.verdicts.length + ' of 3'],
    ['Total cost', '$' + d.totals.costUsd.toFixed(6)],
    ['Run', d.stopped
      ? 'Stopped by the budget gate — ' + (d.stopReason || 'reason not recorded')
      : 'Completed'],
  ]);

  // --- run summary, tier 2: the record a developer checks ---
  const t = d.totals;
  const tech = [
    ['Model source', d.modelSource],
    ['Calls', t.calls],
    ['Prompt tokens', t.promptTokens],
    ['Completion tokens', t.completionTokens],
    ['Total tokens', t.totalTokens],
  ];
  if (t.callsWithUnknownCost) tech.push(['Calls with no reported cost', t.callsWithUnknownCost]);
  tech.push(['Recorded call duration', t.durationMs + ' ms']);
  tech.push(['Wall-clock duration', d.wallClockMs + ' ms']);
  if (d.runId != null) tech.push(['Saved as', 'run #' + d.runId]);
  fillDl($('summary-tech'), tech);
  $('tech').open = false;
}
