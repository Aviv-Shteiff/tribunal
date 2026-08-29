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

function makeCard({ title, verdict, body, toggle, extraClass }) {
  const card = document.createElement('div');
  card.className = 'card' + (extraClass ? ' ' + extraClass : '');

  const head = document.createElement('div');
  head.className = 'chead';
  const name = document.createElement('span');
  name.textContent = title;
  head.appendChild(name);
  if (verdict) {
    const pill = document.createElement('span');
    pill.className = 'pill ' + (verdict === 'justified' ? 'justified' : 'not-justified');
    pill.textContent = verdict;
    head.appendChild(pill);
  }
  card.appendChild(head);

  const det = document.createElement('details');
  const sum = document.createElement('summary');
  sum.textContent = toggle;
  det.appendChild(sum);
  const md = document.createElement('div');
  md.className = 'md';
  md.innerHTML = renderMarkdown(body); // body is escaped inside renderMarkdown
  det.appendChild(md);
  card.appendChild(det);

  return card;
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

  // --- verdicts: id + verdict shown; reasoning behind a per-card toggle ---
  const vc = $('verdicts');
  vc.replaceChildren();
  if (d.verdicts.length === 0) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'No judge produced a valid verdict.';
    vc.appendChild(p);
  }
  for (const v of d.verdicts) {
    vc.appendChild(makeCard({
      title: v.judge_id,
      verdict: v.verdict,
      body: v.reasoning,
      toggle: 'Show full reasoning',
    }));
  }

  // --- representative status table (compact; how a partial run stays visible) ---
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

  // --- speeches: one collapsed card per representative that produced one ---
  const sc = $('speeches');
  sc.replaceChildren();
  for (const rep of d.representatives) {
    if (typeof rep.speech === 'string' && rep.speech.trim() !== '') {
      sc.appendChild(makeCard({
        title: rep.agentId + ' (' + rep.seat + ')',
        body: rep.speech,
        toggle: 'Show speech',
        extraClass: 'speech',
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

  // --- run summary, tier 2: what a developer checking the record needs ---
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
