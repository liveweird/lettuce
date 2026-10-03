// The compact per-request / per-screen table `handleSummary` prints and writes (<label>.table.md): wall time,
// DB time, statement and transaction counts per endpoint, then the per-screen-load sums.
const f = (v, d) => (v === undefined || v === null || Number.isNaN(v) ? '-' : v.toFixed(d));

function trend(data, key) {
  const m = data.metrics[key];
  return m && m.values && m.values.count ? m.values : null;
}

export function tableMarkdown(data, personas, info) {
  const lines = [];
  lines.push(`### reviews-team-view — ${info.scenario}, ${info.vus} VU`);
  lines.push('');
  const total = (data.metrics.http_reqs && data.metrics.http_reqs.values.count) || 0;
  const missing = (data.metrics.server_timing_missing && data.metrics.server_timing_missing.values.count) || 0;
  const failed = (data.metrics.http_req_failed && data.metrics.http_req_failed.values.rate) || 0;
  lines.push(`requests ${total}, failed rate ${f(failed * 100, 2)} %, responses without Server-Timing ${missing}`);
  for (const persona of personas) {
    lines.push('');
    lines.push(`#### ${persona}`);
    lines.push('');
    lines.push('| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | app p95 | stmt p50 | tx p50 |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const e of ['probe', 'periods', 'dictionaries', 'members', 'users', 'reviews']) {
      const k = (m) => trend(data, `${m}{persona:${persona},endpoint:${e}}`);
      const w = k('req_wall_ms');
      if (!w) continue;
      const db = k('req_db_ms') || {};
      const app = k('req_app_ms') || {};
      const st = k('req_stmt') || {};
      const tx = k('req_tx') || {};
      lines.push(`| ${e} | ${w.count} | ${f(w.med, 0)} | ${f(w['p(95)'], 0)} | ${f(db.med, 0)} | ${f(db['p(95)'], 0)} | ${f(app['p(95)'], 0)} | ${f(st.med, 0)} | ${f(tx.med, 0)} |`);
    }
    lines.push('');
    lines.push('| per screen load | n | p50 | p95 | max |');
    lines.push('|---|---:|---:|---:|---:|');
    const rows = [
      ['requests', 'screen_requests', 0], ['sequential wall ms', 'screen_wall_ms', 0],
      ['critical-path wall ms (est.)', 'screen_critical_ms', 0], ['db ms', 'screen_db_ms', 0],
      ['statements', 'screen_stmt', 0], ['transactions', 'screen_tx', 0],
    ];
    for (const [label, key, d] of rows) {
      const s = trend(data, `${key}{persona:${persona}}`);
      if (s) lines.push(`| ${label} | ${s.count} | ${f(s.med, d)} | ${f(s['p(95)'], d)} | ${f(s.max, d)} |`);
    }
  }
  return lines.join('\n');
}
