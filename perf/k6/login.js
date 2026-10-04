// k6 scenario `login`: POST /api/v1/login (pages/Login.tsx, api/auth.ts) — bcrypt cost 12 on the app's JVM. Each
// iteration is one sign-in; the response is anonymous: no Server-Timing (it would be an account-enumeration oracle), so
// only wall time is measured; the pgss window shows the 3-5 statements a login runs.
// Shape: `perf/run.sh k6 login --vus 50 --ramp-up 30s --duration 1m` ramps 0 -> 50 VUs and holds (a login storm, e.g. the
// Monday-morning peak); 1 VU x N iterations gives the unloaded cost of one bcrypt verification.
// ONE ACCOUNT PER VU (FINDINGS F15, resolved 2026-10-04): VU n signs into the generated IC `perf-ic-<n, 4 digits>`
// (the generator numbers its ICs 1..N contiguously, all active, all sharing PERF_PASSWORD) and never into anyone
// else's. The earlier round-robin over 6 shared accounts put ~8 VUs on each account, and the per-account lockout
// RESERVES an attempt before bcrypt (`LoginThrottle.reserveAttempt`), so a 6th concurrent correct-password sign-in
// into one account was answered 429 before an in-flight success could clear the counter — an artefact of the test,
// not of the app (real users sign into their own account). With one account per VU only sequential sign-ins hit an
// account, so a 429 must not occur: the thresholds below fail the run on ANY non-200 (a 429 included).
// The 1-VU run (`--persona ic`) uses VU 1's account, perf-ic-0001.
import http from 'k6/http';
import { fail } from 'k6';
import { defineScenario } from './lib/replay.js';
import { PERF_PASSWORD } from './lib/auth.js';

const VUS = parseInt(__ENV.VUS || '1', 10);
const BASE_URL = __ENV.BASE_URL || 'http://app:8080'; // replay.js has already pinned it to the perf stack
const DOMAIN = 'perf.lettuce.local';

/** The account VU `vu` (1-based) signs into: perf-ic-0001 ... (the generator's deterministic IC pattern). */
function accountOf(vu) {
  return `perf-ic-${String(vu).padStart(4, '0')}@${DOMAIN}`;
}

const def = {
  name: 'login',
  // One label for every VU: the account is per VU (accountOf), not per persona, so the table has a single row.
  personas: ['ic'],
  screens: {
    login: {
      endpoints: ['login'],
      run(s) {
        s.send('POST', '/api/v1/login', { email: accountOf(__VU), password: PERF_PASSWORD }, 'login', [200], true);
      },
    },
  },
  personaScreens: { ic: ['login'] },
};

const sc = defineScenario(def);
// Zero tolerance: every sign-in must be a 200 (no lockout 429, no 401) — the shared thresholds allow 0.1 %.
sc.options.thresholds.http_req_failed = ['rate==0'];
sc.options.thresholds.checks = ['rate==1'];

export const options = sc.options;
export function setup() {
  // Fail fast when the dataset has fewer ICs than VUs: the IC numbers are contiguous, so the highest one existing
  // proves them all (one extra bcrypt verification, before the measured window).
  const res = http.post(`${BASE_URL}/api/v1/login`, JSON.stringify({ email: accountOf(VUS), password: PERF_PASSWORD }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { endpoint: 'login-precheck' },
    responseCallback: http.expectedStatuses(200, 401),
  });
  if (res.status !== 200) {
    fail(`login scenario needs ${VUS} distinct generated accounts (perf-ic-0001..perf-ic-${String(VUS).padStart(4, '0')}), `
      + `but ${accountOf(VUS)} did not sign in (HTTP ${res.status}) — is the dataset seeded at a scale with >= ${VUS} ICs? `
      + 'Lower --vus or reseed.');
  }
  return sc.setup();
}
export default sc.default;
export const handleSummary = sc.handleSummary;
