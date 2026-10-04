// The shared replay harness of the per-screen scenarios (everything but `reviews-team-view`, which predates it and
// keeps its own sequential-chain accounting in lib/screens.js).
//
// A SCREEN is one function that replays what the SPA's page component fires on first load, in the order and
// with the parallelism the browser has: queries React Query enables at the same time go through `s.batch([...])`
// (k6's http.batch — truly simultaneous, like the browser's parallel fetches), a query that waits for another's
// data (`enabled: !!x`) or a `listAll*` paging loop goes through `s.get(...)` / `s.pageAll(...)` one after the
// other. `s.end()` records the load: elapsed wall time, summed request time, DB time, statements, transactions.
//
// A SCENARIO (`defineScenario`) maps personas to the screens they can actually reach — the SPA's gating
// (feature flag, isManager, auditor) decides, never "who would be interesting": replaying a screen a role cannot
// open measures nothing real (the M1 review's rule).
//
// Run settings (env, set by `perf/run.sh k6`): PERSONA (a persona name | `mixed` = VU n takes personas[(n-1) % len]
// | `all` = every iteration walks every persona), VUS, ITERATIONS | DURATION, THINK_MIN/THINK_MAX, BASE_URL, LABEL.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { ALL_PERSONAS, loginAll } from './auth.js';
import {
  recordRequest, screenWall, screenSeq, screenDb, screenRequests, screenStmt, screenTx,
} from './metrics.js';
import { screenTableMarkdown } from './report.js';

const BASE_URL = __ENV.BASE_URL || 'http://app:8080';
const PERSONA = __ENV.PERSONA || '';
const VUS = parseInt(__ENV.VUS || '1', 10);
const THINK_MIN = parseFloat(__ENV.THINK_MIN || '0');
const THINK_MAX = parseFloat(__ENV.THINK_MAX || '0');
// The scenarios write (mixed-50vu) and sign in as the perf accounts: they only ever talk to the perf stack's app service
// (run.sh passes http://app:8080 on the lettuce-perf network) or its published loopback port — never a dev or real URL.
if (!/^http:\/\/(app:8080|127\.0\.0\.1:18080|localhost:18080)$/.test(BASE_URL)) {
  throw new Error('BASE_URL must be the perf stack (http://app:8080 inside the lettuce-perf network)');
}

/** buildQuery (web/src/api/http.ts): insertion order. `undefined`/`null` values are skipped like the SPA does. */
export function qs(params) {
  return Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`)
    .join('&');
}

/** `YYYY-MM-DD` of today (UTC) shifted by `days` — the SPA derives its date windows from the browser clock. */
export function isoDate(days = 0, fromMs = Date.now()) {
  return new Date(fromMs + days * 86400000).toISOString().slice(0, 10);
}

const callbacks = {};
/** k6 counts any non-2xx/3xx as `http_req_failed`; a status a screen EXPECTS (a fill-gate 403, a 404 before the first answer) is not a failure. */
export function expected(statuses) {
  const key = statuses.join(',');
  if (!callbacks[key]) callbacks[key] = http.expectedStatuses(...statuses);
  return callbacks[key];
}

export class Screen {
  constructor(base, sessions, personaName, screenName) {
    this.base = base;
    this.sessions = sessions;
    this.persona = personaName;
    this.name = screenName;
    this.session = sessions[personaName];
    this.headers = { Authorization: `Bearer ${this.session.token}`, Accept: 'application/json' };
    this.t0 = Date.now();
    this.seq = 0;
    this.db = 0;
    this.stmt = 0;
    this.tx = 0;
    this.requests = 0;
    this.failed = false;
  }

  /** The user id of another persona (every persona of the scenario is logged in during setup). */
  userId(personaName) {
    return this.sessions[personaName].userId;
  }

  _tags(endpoint) {
    return { persona: this.persona, screen: this.name, endpoint };
  }

  _record(res, endpoint, expect, anonymous = false) {
    const tags = this._tags(endpoint);
    const ok = check(res, { [`${this.name}/${endpoint} ${expect.join('|')}`]: (r) => expect.includes(r.status) }, tags);
    const r = recordRequest(res, tags, anonymous);
    this.seq += r.wall;
    this.db += r.db;
    this.stmt += r.stmt;
    this.tx += r.tx;
    this.requests += 1;
    if (!ok) this.failed = true;
    return ok;
  }

  /** One GET; the response, or null when its status is not in `expect`. */
  get(path, endpoint, expect = [200]) {
    const res = http.get(`${this.base}${path}`, { headers: this.headers, tags: this._tags(endpoint), responseCallback: expected(expect) });
    return this._record(res, endpoint, expect) ? res : null;
  }

  /** One request with a JSON body (POST/PUT/PATCH). */
  send(method, path, body, endpoint, expect = [200, 201, 204], anonymous = false) {
    const headers = anonymous ? { Accept: 'application/json' } : this.headers;
    const res = http.request(method, `${this.base}${path}`, body === undefined ? null : JSON.stringify(body), {
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      tags: this._tags(endpoint),
      responseCallback: expected(expect),
    });
    return this._record(res, endpoint, expect, anonymous) ? res : null;
  }

  post(path, body, endpoint, expect) {
    return this.send('POST', path, body, endpoint, expect);
  }

  /** Requests the browser fires at the same moment: [[path, endpoint], ...] -> responses (null = failed). */
  batch(requests, expect = [200]) {
    const reqs = requests.map(([path, endpoint]) => ({
      method: 'GET',
      url: `${this.base}${path}`,
      params: { headers: this.headers, tags: this._tags(endpoint), responseCallback: expected(expect) },
    }));
    const responses = http.batch(reqs);
    return responses.map((res, i) => (this._record(res, requests[i][1], expect) ? res : null));
  }

  /** The `listAll*` idiom: page after page until the accumulated count reaches `total`; returns the items. */
  pageAll(pathForPage, endpoint) {
    const items = [];
    for (let page = 1; ; page += 1) {
      const res = this.get(pathForPage(page), endpoint);
      if (res === null) return items;
      const body = res.json();
      for (const it of body.items) items.push(it);
      if (items.length >= body.total || body.items.length === 0) return items;
    }
  }

  /** Continues a `listAll*` loop whose page 1 was already fetched (e.g. inside a batch); returns the items. */
  pageMore(pathForPage, firstRes, endpoint) {
    if (firstRes === null) return [];
    const first = firstRes.json();
    const items = first.items.slice();
    for (let page = 2; items.length < first.total; page += 1) {
      const res = this.get(pathForPage(page), endpoint);
      if (res === null) break;
      const body = res.json();
      for (const it of body.items) items.push(it);
      if (body.items.length === 0) break;
    }
    return items;
  }

  /** Records the screen load; returns {failed}. */
  end() {
    const tags = { persona: this.persona, screen: this.name };
    screenWall.add(Date.now() - this.t0, tags);
    screenSeq.add(this.seq, tags);
    screenDb.add(this.db, tags);
    screenRequests.add(this.requests, tags);
    screenStmt.add(this.stmt, tags);
    screenTx.add(this.tx, tags);
    return { failed: this.failed };
  }
}

/**
 * The Shell's queries (App.tsx), mounted by every authenticated page next to the page's own: the signed-in user,
 * the managed-teams probe (isManager), the visible alerts and the bell's unread badge. A screen's FIRST load puts
 * them into its first `s.batch`; later tab clicks do not repeat them. (The probe is also what gates manager tabs.)
 */
export const SHELL_ENDPOINTS = ['shell-user', 'shell-probe', 'shell-alerts', 'shell-bell'];
export function shellRequests(s) {
  const me = s.session.userId;
  return [
    [`/api/v1/users/${me}`, 'shell-user'],
    [`/api/v1/teams?${qs({ page: 1, pageSize: 1, managerId: me })}`, 'shell-probe'],
    ['/api/v1/alerts/visible', 'shell-alerts'],
    [`/api/v1/notifications?${qs({ page: 1, pageSize: 1, wasSeen: false })}`, 'shell-bell'],
  ];
}

const REQ_METRICS = ['req_wall_ms', 'req_db_ms', 'req_app_ms', 'req_stmt', 'req_tx'];
const SCREEN_METRICS = ['screen_wall_ms', 'screen_seq_ms', 'screen_db_ms', 'screen_requests', 'screen_stmt', 'screen_tx'];

// The summary must never carry credentials: k6 puts setup()'s return value (the personas' bearer tokens) into
// `data.setup_data`; anything JWT-shaped is dropped as a second line of defence. Committed baselines are
// grepped for "eyJ" (perf/README.md).
function scrub(key, value) {
  if (key === 'setup_data') return undefined;
  if (typeof value === 'string' && value.indexOf('eyJ') === 0) return undefined;
  return value;
}

/**
 * def = {
 *   name:     'dashboard',
 *   personas: ['ceo', 'director', ...],          // the personas that reach the scenario at all (also `mixed` order)
 *   screens:  { 'cards': { endpoints: ['summary', ...], run: (s) => {...} }, ... },
 *   personaScreens: { ceo: ['cards', ...], ... }, // which screens each persona loads, in order
 *   extraLogins: ['ceo'],                         // personas logged in only so a screen can read their userId
 *   thinkDefault: [min, max] (optional),
 *   vuPersonas: [..] (optional: the weighted round-robin list `mixed` assigns VUs from; default personas)
 *   iteration: (persona) => [screen names] (optional: pick the screens of one iteration at random instead of walking personaScreens)
 * }
 * Returns {options, setup, default, handleSummary} to re-export from the scenario file.
 */
export function defineScenario(def) {
  const personaList = () => {
    if (PERSONA === 'mixed' || PERSONA === '') return def.personas;
    if (PERSONA === 'all') return def.personas;
    if (!def.personas.includes(PERSONA)) throw new Error(`persona ${PERSONA} cannot reach ${def.name} (${def.personas.join(', ')})`);
    return [PERSONA];
  };
  const active = personaList();

  const thresholds = { http_req_failed: ['rate<0.001'], checks: ['rate>0.999'] };
  for (const persona of active) {
    for (const screen of def.personaScreens[persona] || []) {
      for (const m of SCREEN_METRICS) thresholds[`${m}{persona:${persona},screen:${screen}}`] = ['p(95)>=0'];
      for (const e of def.screens[screen].endpoints) {
        for (const m of REQ_METRICS) thresholds[`${m}{persona:${persona},screen:${screen},endpoint:${e}}`] = ['p(95)>=0'];
      }
    }
  }

  // RAMP_UP (run.sh --ramp-up 2m): 0 -> VUS over RAMP_UP, then hold for DURATION (the realistic-mix shape).
  const scenario = __ENV.RAMP_UP
    ? {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [{ duration: __ENV.RAMP_UP, target: VUS }, { duration: __ENV.DURATION || '5m', target: VUS }],
      gracefulRampDown: '30s',
    }
    : __ENV.ITERATIONS
      ? { executor: 'per-vu-iterations', vus: VUS, iterations: parseInt(__ENV.ITERATIONS, 10), maxDuration: '60m' }
      : { executor: 'constant-vus', vus: VUS, duration: __ENV.DURATION || '3m' };

  const options = {
    scenarios: { screen: scenario },
    thresholds,
    summaryTrendStats: ['count', 'avg', 'min', 'med', 'p(90)', 'p(95)', 'max'],
    discardResponseBodies: false,
  };

  const label = __ENV.LABEL || `${def.name}.${PERSONA || 'mixed'}.vu${VUS}`;

  return {
    options,
    setup() {
      const names = Array.from(new Set(active.concat(def.extraLogins || [])));
      const sessions = {};
      const byEmail = loginAll(BASE_URL, names, ALL_PERSONAS);
      for (const n of names) sessions[n] = byEmail[ALL_PERSONAS[n].email];
      return { sessions };
    },
    default(data) {
      const names = PERSONA === 'all' ? def.personas
        : PERSONA === 'mixed' || PERSONA === '' ? [(def.vuPersonas || def.personas)[(__VU - 1) % (def.vuPersonas || def.personas).length]]
          : [PERSONA];
      for (const name of names) {
        // def.iteration(persona) lets a scenario pick the screens of ONE iteration at random (the mixed run).
        for (const screenName of def.iteration ? def.iteration(name) : def.personaScreens[name] || []) {
          const s = new Screen(BASE_URL, data.sessions, name, screenName);
          def.screens[screenName].run(s);
          s.end();
        }
      }
      if (THINK_MAX > 0) sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN));
    },
    handleSummary(data) {
      const md = screenTableMarkdown(data, def, active, {
        vus: VUS,
        run: `${PERSONA || 'mixed'}, ${__ENV.ITERATIONS ? `${__ENV.ITERATIONS} iterations/VU` : `${__ENV.DURATION || '3m'}`}`,
      });
      return {
        [`/out/${label}.summary.json`]: JSON.stringify(data, scrub),
        [`/out/${label}.table.md`]: md,
        stdout: `\n${md}\n`,
      };
    },
  };
}
