// Custom metrics: the app's Server-Timing (db;dur=<ms>;desc="stmt=<n> tx=<m>", app;dur=<ms>), parsed per
// response, next to k6's own wall time. Everything is tagged persona + endpoint (the URL template with ids
// and page numbers stripped) so the summary can report per-endpoint percentiles.
import { Trend, Counter } from 'k6/metrics';

// Per request.
export const reqWall = new Trend('req_wall_ms', true);
export const reqDb = new Trend('req_db_ms', true);
export const reqApp = new Trend('req_app_ms', true);
export const reqStmt = new Trend('req_stmt');
export const reqTx = new Trend('req_tx');
export const reqBytes = new Trend('req_bytes');
// Per chain (a run of requests the SPA issues one after another) — tagged persona + chain.
export const chainWall = new Trend('chain_wall_ms', true);
export const chainRequests = new Trend('chain_requests');
export const chainStmt = new Trend('chain_stmt');
export const chainTx = new Trend('chain_tx');
// Per screen load (one iteration) — tagged persona.
export const screenWall = new Trend('screen_wall_ms', true);
export const screenCritical = new Trend('screen_critical_ms', true);
export const screenDb = new Trend('screen_db_ms', true);
export const screenRequests = new Trend('screen_requests');
export const screenStmt = new Trend('screen_stmt');
export const screenTx = new Trend('screen_tx');
// Authenticated responses without a Server-Timing header (must stay 0 on the perf stack).
export const serverTimingMissing = new Counter('server_timing_missing');

const DB_RE = /(?:^|,\s*)db;dur=([0-9.]+)(?:;desc="stmt=(\d+) tx=(\d+)")?/;
const APP_RE = /(?:^|,\s*)app;dur=([0-9.]+)/;

function header(res, name) {
  const wanted = name.toLowerCase();
  for (const key of Object.keys(res.headers)) {
    if (key.toLowerCase() === wanted) return res.headers[key];
  }
  return undefined;
}

/** {db, stmt, tx, app} from a response's Server-Timing header, or null when it carries none. */
export function parseServerTiming(res) {
  const raw = header(res, 'Server-Timing');
  if (!raw) return null;
  const db = DB_RE.exec(raw);
  if (!db) return null;
  const app = APP_RE.exec(raw);
  return {
    db: parseFloat(db[1]),
    stmt: db[2] === undefined ? 0 : parseInt(db[2], 10),
    tx: db[3] === undefined ? 0 : parseInt(db[3], 10),
    app: app ? parseFloat(app[1]) : 0,
  };
}

/** Records one response; returns its numbers for the caller's chain/screen sums. */
export function recordRequest(res, tags) {
  const wall = res.timings.duration;
  reqWall.add(wall, tags);
  const bytes = res.body ? res.body.length : 0;
  reqBytes.add(bytes, tags);
  const st = parseServerTiming(res);
  if (st === null) {
    serverTimingMissing.add(1, tags);
    return { wall, db: 0, stmt: 0, tx: 0 };
  }
  reqDb.add(st.db, tags);
  reqApp.add(st.app, tags);
  reqStmt.add(st.stmt, tags);
  reqTx.add(st.tx, tags);
  return { wall, db: st.db, stmt: st.stmt, tx: st.tx };
}
