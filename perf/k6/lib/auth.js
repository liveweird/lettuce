// Sign-in for the perf personas (perf/README.md, .claude/docs/performance.md). The generated accounts
// share ONE password; the only account outside the generator is the V6 seed admin (not used here).
import http from 'k6/http';
import { fail } from 'k6';

export const PERF_PASSWORD = 'perf-pass-2026';
const DOMAIN = 'perf.lettuce.local';
// The V6 seed admin's password (`changeme`, development mode — the perf stack never sets ADMIN_INITIAL_PASSWORD).
const ADMIN_PASSWORD = 'changeme';

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

// The personas of the later scenarios (lib/replay.js). Unlike the table above they carry no "scope": what a persona
// loads is decided per screen by the scenario's personaScreens, from what the SPA lets that role reach.
//   ceo      level 1, ~510 transitive reports        director  perf-dir-01, ~50 transitive reports
//   lead     perf-lead-001, 6-7 direct reports        lead2     perf-lead-042 (under another director)
//   ic       perf-ic-0001, no reports                 hr        auditor (HR role), no team
//   admin    the V6 seed admin (ADMIN role, no team; its password is the seed's — only users-admin/login use it)
export const ALL_PERSONAS = {
  ceo: { email: `perf-ceo@${DOMAIN}` },
  director: { email: `perf-dir-01@${DOMAIN}` },
  lead: { email: `perf-lead-001@${DOMAIN}` },
  lead2: { email: `perf-lead-042@${DOMAIN}` },
  ic: { email: `perf-ic-0001@${DOMAIN}` },
  // Two more ICs (other teams) so the mixed run's writers are not all one person.
  ic2: { email: `perf-ic-0100@${DOMAIN}` },
  ic3: { email: `perf-ic-0250@${DOMAIN}` },
  hr: { email: `perf-hr@${DOMAIN}` },
  admin: { email: 'admin@lettuce.local', password: ADMIN_PASSWORD },
};

/** One login per DISTINCT account (bcrypt cost 12 ~ 250 ms each); returns {email: {token, userId}}. */
export function loginAll(baseUrl, personaNames, registry = PERSONAS) {
  const sessions = {};
  for (const name of personaNames) {
    const { email, password } = registry[name];
    if (sessions[email]) continue;
    const res = http.post(`${baseUrl}/api/v1/login`, JSON.stringify({ email, password: password || PERF_PASSWORD }), {
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
