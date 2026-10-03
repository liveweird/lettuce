// k6 scenario `reviews-team-view`: Performance -> Team's performance, replayed request by request
// (lib/screens.js). Run it through `perf/run.sh k6 reviews-team-view …` — that wires the network, the output
// directory, pg_stat_statements capture and the image pin. Settings come from the environment:
//
//   PERSONA      ceo-all | ceo-direct | director-all | lead | lead-2 | hr   one persona
//                mixed                                                    VU n -> MIX[(n-1) % 5] (lib/auth.js; no IC — an IC has no such tab)
//                all                                                      every iteration walks every persona (warm-up)
//   VUS          virtual users (default 1)
//   ITERATIONS   screen loads PER VU, e.g. 3 (a fixed-iteration run)       — or —
//   DURATION     e.g. 3m (a constant-load run; default when ITERATIONS is unset: 3m)
//   THINK_MIN / THINK_MAX   seconds slept between loads (default 0 = closed-loop saturation)
//   BASE_URL     default http://app:8080 (the compose service inside the lettuce-perf network)
//   LABEL        output file stem (default <scenario>.<persona>.vu<N>)
//
// Thresholds are INFORMATIONAL: `p(95)>=0` always passes — it exists to make k6 keep a per-persona,
// per-endpoint sub-metric in the summary. The one real gate is a failed-request rate.
import { sleep } from 'k6';
import { loginAll, PERSONAS, MIX } from './lib/auth.js';
import { reviewsTeamView } from './lib/screens.js';
import { tableMarkdown } from './lib/report.js';

const BASE_URL = __ENV.BASE_URL || 'http://app:8080';
const PERSONA = __ENV.PERSONA || 'ceo-all';
const VUS = parseInt(__ENV.VUS || '1', 10);
const THINK_MIN = parseFloat(__ENV.THINK_MIN || '0');
const THINK_MAX = parseFloat(__ENV.THINK_MAX || '0');
const LABEL = __ENV.LABEL || `reviews-team-view.${PERSONA}.vu${VUS}`;

function personaNames() {
  if (PERSONA === 'mixed') return MIX;
  if (PERSONA === 'all') return Object.keys(PERSONAS);
  if (!PERSONAS[PERSONA]) throw new Error(`unknown PERSONA ${PERSONA}`);
  return [PERSONA];
}

const ENDPOINTS = ['probe', 'periods', 'dictionaries', 'members', 'users', 'reviews'];
const REQ_METRICS = ['req_wall_ms', 'req_db_ms', 'req_app_ms', 'req_stmt', 'req_tx'];
const SCREEN_METRICS = ['screen_wall_ms', 'screen_critical_ms', 'screen_db_ms', 'screen_requests', 'screen_stmt', 'screen_tx'];
const CHAINS = ['probe', 'dictionaries', 'periods', 'stray-roster', 'members', 'users', 'reviews'];
const CHAIN_METRICS = ['chain_wall_ms', 'chain_requests', 'chain_stmt', 'chain_tx'];

function thresholds() {
  const t = { http_req_failed: ['rate<0.001'], checks: ['rate>0.999'] };
  for (const persona of personaNames()) {
    for (const m of SCREEN_METRICS) t[`${m}{persona:${persona}}`] = ['p(95)>=0'];
    for (const e of ENDPOINTS) {
      for (const m of REQ_METRICS) t[`${m}{persona:${persona},endpoint:${e}}`] = ['p(95)>=0'];
    }
    for (const c of CHAINS) {
      for (const m of CHAIN_METRICS) t[`${m}{persona:${persona},chain:${c}}`] = ['p(95)>=0'];
    }
  }
  return t;
}

const scenario = __ENV.ITERATIONS
  ? { executor: 'per-vu-iterations', vus: VUS, iterations: parseInt(__ENV.ITERATIONS, 10), maxDuration: '60m' }
  : { executor: 'constant-vus', vus: VUS, duration: __ENV.DURATION || '3m' };

export const options = {
  scenarios: { screen: scenario },
  thresholds: thresholds(),
  summaryTrendStats: ['count', 'avg', 'min', 'med', 'p(90)', 'p(95)', 'max'],
  discardResponseBodies: false,
};

export function setup() {
  return { sessions: loginAll(BASE_URL, personaNames()) };
}

export default function (data) {
  const names = PERSONA === 'all' ? Object.keys(PERSONAS) : [PERSONA === 'mixed' ? MIX[(__VU - 1) % MIX.length] : PERSONA];
  for (const name of names) {
    reviewsTeamView(BASE_URL, data.sessions[PERSONAS[name].email], name);
  }
  if (THINK_MAX > 0) sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN));
}

// The summary must never carry credentials: k6 puts setup()'s return value (the personas' bearer tokens) into
// `data.setup_data`, and anything JWT-shaped is dropped by the replacer as a second line of defence. The
// committed baselines are grepped for "eyJ" (perf/README.md).
function scrub(key, value) {
  if (key === 'setup_data') return undefined;
  if (typeof value === 'string' && value.indexOf('eyJ') === 0) return undefined;
  return value;
}

export function handleSummary(data) {
  const md = tableMarkdown(data, personaNames(), { vus: VUS, scenario: `${PERSONA}, ${__ENV.ITERATIONS ? `${__ENV.ITERATIONS} iterations/VU` : `${__ENV.DURATION || '3m'}`}` });
  return {
    [`/out/${LABEL}.summary.json`]: JSON.stringify(data, scrub),
    [`/out/${LABEL}.table.md`]: md,
    stdout: `\n${md}\n`,
  };
}
