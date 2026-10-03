// Sign-in for the perf personas (perf/README.md, .claude/docs/performance.md). The generated accounts
// share ONE password; the only account outside the generator is the V6 seed admin (not used here).
import http from 'k6/http';
import { fail } from 'k6';

export const PERF_PASSWORD = 'perf-pass-2026';
const DOMAIN = 'perf.lettuce.local';

// scope = the SPA's reportsScope on the Performance -> Team's performance screen:
//   direct  -> members roster = direct reports            (stored default)
//   all     -> members roster = the transitive chain      (includeIndirect=true)
//   auditor -> an HR caller who manages no team: the org-wide users list + view=all reviews
export const PERSONAS = {
  'ceo-all': { email: `perf-ceo@${DOMAIN}`, scope: 'all', label: 'CEO, "all reports" (~510 transitive)' },
  'ceo-direct': { email: `perf-ceo@${DOMAIN}`, scope: 'direct', label: 'CEO, "direct reports" (10)' },
  'director-all': { email: `perf-dir-01@${DOMAIN}`, scope: 'all', label: 'director, "all reports" (~50)' },
  lead: { email: `perf-lead-001@${DOMAIN}`, scope: 'direct', label: 'team lead (6-7 direct)' },
  // A second lead under another director (perf-lead-042; perf-lead-001 sits under perf-dir-01): the mix needs more
  // than one lead. ICs are NOT replayed here — an IC never sees the Team's-performance tab (Performance.tsx
  // showManagedTab = isManager || auditor); their screens belong to the later scenarios.
  'lead-2': { email: `perf-lead-042@${DOMAIN}`, scope: 'direct', label: 'second team lead (6-7 direct)' },
  hr: { email: `perf-hr@${DOMAIN}`, scope: 'auditor', label: 'HR auditor (no team)' },
};

// The realistic mix of the 50-VU run: VU n takes MIX[(n - 1) % MIX.length].
export const MIX = ['ceo-all', 'director-all', 'lead', 'lead-2', 'hr'];

/** One login per DISTINCT account (bcrypt cost 12 ~ 250 ms each); returns {email: {token, userId}}. */
export function loginAll(baseUrl, personaNames) {
  const sessions = {};
  for (const name of personaNames) {
    const { email } = PERSONAS[name];
    if (sessions[email]) continue;
    const res = http.post(`${baseUrl}/api/v1/login`, JSON.stringify({ email, password: PERF_PASSWORD }), {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'login' },
    });
    if (res.status !== 200) {
      fail(`login failed for ${name} (HTTP ${res.status}) — is the perf dataset seeded and the app up?`);
    }
    const body = res.json();
    sessions[email] = { token: body.token, userId: body.userId };
  }
  return sessions;
}
