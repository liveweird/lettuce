// k6 scenario `pulse-results`: the Pulse hub (/pulse — pages/Pulse*.tsx, components/PulseTeamResultCard.tsx, api/pulse.ts).
// The PULSE_SURVEYS flag is on for every perf user; the default tab is `survey`; `participation` needs isManager or HR.
//   survey          first load: Shell || pulse-surveys/cycles, then my-response of the OPEN cycle (404 before the first answer,
//                   403 for a non-participant — both expected)
//   results         ?tab=results: Shell || cycles || visible-teams || shares?view=withMe&resourceType=PULSE_TEAM_RESULTS&status=ACTIVE;
//                   the most recently CLOSED cycle; the default view = "Teams I belong to" (memberTeams), HR with no own team
//                   defaults to "all"; per team, all in parallel: cycles/<c>/results?teamId&mode=direct and (monitors/HR)
//                   cycles/<c>/comments?teamId&mode=direct; the card's small trend chart loads lazily (v4.15.0, the card's
//                   IntersectionObserver, 300 px margin), so trend?teamId&mode=direct is replayed for the first VISIBLE_CARDS = 3
//                   teams only — a documented approximation of a 1280x720 viewport plus the margin (the browser runner
//                   `perf/run.sh web pulse-results` measures the truth). A plain 403 on results is the fill gate (the caller did
//                   not answer that cycle; ~10-20 % of participants) and is expected.
//   results-managed the "Teams I manage" segment (managers): the same per-team cards for every monitored team (the CEO's = all 81)
//   trend           ?tab=trend: Shell || visible-teams, then trend per team of the default view (the Trend TAB is not lazy)
//   participation   ?tab=participation (managers + HR): Shell || cycles, then cycles/<c>/participation-status
import http from 'k6/http';
import { defineScenario, qs, shellRequests, SHELL_ENDPOINTS, expected } from './lib/replay.js';

const CARD = ['results', 'trend', 'comments'];
const EXPECT = [200, 403, 404, 409];
// The card's trend chart is fetched only once its section is within 300 px of the viewport (v4.15.0): the first
// VISIBLE_CARDS cards of a results screen stand in for "in view" (a 1280x720 viewport + the margin ~ 3 cards of ~450 px).
const VISIBLE_CARDS = 3;

function cardRequests(cycleId, teamId, comments, trendInView) {
  const q = qs({ teamId, mode: 'direct' });
  const reqs = [[`/api/v1/pulse-surveys/cycles/${cycleId}/results?${q}`, 'results']];
  if (trendInView) reqs.push([`/api/v1/pulse-surveys/trend?${q}`, 'trend']);
  if (comments) reqs.push([`/api/v1/pulse-surveys/cycles/${cycleId}/comments?${q}`, 'comments']);
  return reqs;
}

function lastClosedCycle(cyclesRes) {
  if (cyclesRes === null) return null;
  const closed = cyclesRes.json().items.filter((c) => c.status === 'CLOSED');
  closed.sort((a, b) => b.closedAt - a.closedAt);
  return closed.length ? closed[0] : null;
}

// Runs the cards through k6's batch (6 simultaneous per host — the browser's own HTTP/1.1 connection cap),
// lenient on the fill-gate statuses. Comments: fired at once for HR / monitored teams, otherwise only AFTER the
// results response says `canReadComments` (PulseTeamResultCard.tsx).
function cards(s, cycle, teams, monitoredIds, isHr) {
  const first = [];
  const lazy = [];
  teams.forEach((t, i) => {
    const eager = isHr || monitoredIds.has(t.id);
    first.push(...cardRequests(cycle.id, t.id, eager, i < VISIBLE_CARDS));
    if (!eager) lazy.push(t.id);
  });
  const run = (reqs) => {
    const out = [];
    for (let i = 0; i < reqs.length; i += 60) {
      const chunk = reqs.slice(i, i + 60).map(([path, endpoint]) => ({ method: 'GET', url: `${s.base}${path}`, params: { headers: s.headers, tags: s._tags(endpoint), responseCallback: expected(EXPECT) } }));
      http.batch(chunk).forEach((res, j) => { s._record(res, reqs[i + j][1], EXPECT); out.push(res); });
    }
    return out;
  };
  const responses = run(first);
  const readable = [];
  first.forEach(([path, endpoint], i) => {
    if (endpoint !== 'results' || responses[i].status !== 200) return;
    const teamId = parseInt(/teamId=(\d+)/.exec(path)[1], 10);
    if (lazy.includes(teamId) && responses[i].json().canReadComments === true) readable.push(teamId);
  });
  run(readable.map((id) => [`/api/v1/pulse-surveys/cycles/${cycle.id}/comments?${qs({ teamId: id, mode: 'direct' })}`, 'comments']));
}

const def = {
  name: 'pulse-results',
  personas: ['ceo', 'director', 'lead', 'ic', 'hr', 'admin'],
  screens: {
    survey: {
      endpoints: [...SHELL_ENDPOINTS, 'cycles', 'my-response'],
      run(s) {
        const res = s.batch([...shellRequests(s), ['/api/v1/pulse-surveys/cycles', 'cycles']]);
        const cycles = res[SHELL_ENDPOINTS.length];
        const open = cycles === null ? null : cycles.json().items.find((c) => c.status === 'OPEN');
        if (open) s.get(`/api/v1/pulse-surveys/cycles/${open.id}/my-response`, 'my-response', EXPECT);
      },
    },
    results: {
      endpoints: [...SHELL_ENDPOINTS, 'cycles', 'visible-teams', 'shares', ...CARD],
      run(s) {
        const res = s.batch([
          ...shellRequests(s),
          ['/api/v1/pulse-surveys/cycles', 'cycles'],
          ['/api/v1/pulse-surveys/visible-teams', 'visible-teams'],
          [`/api/v1/shares?${qs({ view: 'withMe', resourceType: 'PULSE_TEAM_RESULTS', status: 'ACTIVE', pageSize: 100 })}`, 'shares'],
        ]);
        const n = SHELL_ENDPOINTS.length;
        const cycle = lastClosedCycle(res[n]);
        const vt = res[n + 1] === null ? null : res[n + 1].json();
        if (!cycle || vt === null) return;
        const monitored = new Set(vt.monitoredTeams.map((t) => t.id));
        const hr = s.persona === 'hr';
        // The SPA: the stored default view is "member"; an HR caller with no own and no monitored team falls back to "all".
        const teams = vt.memberTeams.length === 0 && monitored.size === 0 && hr ? vt.allTeams : vt.memberTeams;
        cards(s, cycle, teams, monitored, hr);
      },
    },
    'results-managed': {
      endpoints: [...CARD, 'cycles', 'visible-teams'],
      run(s) {
        const res = s.batch([['/api/v1/pulse-surveys/cycles', 'cycles'], ['/api/v1/pulse-surveys/visible-teams', 'visible-teams']]);
        const cycle = lastClosedCycle(res[0]);
        if (!cycle || res[1] === null) return;
        const vt = res[1].json();
        cards(s, cycle, vt.monitoredTeams, new Set(vt.monitoredTeams.map((t) => t.id)), false);
      },
    },
    trend: {
      endpoints: [...SHELL_ENDPOINTS, 'visible-teams', 'trend'],
      run(s) {
        const res = s.batch([...shellRequests(s), ['/api/v1/pulse-surveys/visible-teams', 'visible-teams']]);
        const vt = res[SHELL_ENDPOINTS.length] === null ? null : res[SHELL_ENDPOINTS.length].json();
        if (vt === null) return;
        const monitored = vt.monitoredTeams.length;
        const teams = vt.memberTeams.length === 0 && monitored === 0 && s.persona === 'hr' ? vt.allTeams : vt.memberTeams;
        if (teams.length) s.batch(teams.map((t) => [`/api/v1/pulse-surveys/trend?${qs({ teamId: t.id, mode: 'direct' })}`, 'trend']));
      },
    },
    participation: {
      endpoints: [...SHELL_ENDPOINTS, 'cycles', 'participation'],
      run(s) {
        const res = s.batch([...shellRequests(s), ['/api/v1/pulse-surveys/cycles', 'cycles']]);
        const cycles = res[SHELL_ENDPOINTS.length];
        if (cycles === null) return;
        const items = cycles.json().items;
        const pick = items.find((c) => c.status === 'OPEN')
          || items.filter((c) => c.status === 'OPEN' || c.status === 'CLOSED').sort((a, b) => b.id - a.id)[0];
        if (pick) s.get(`/api/v1/pulse-surveys/cycles/${pick.id}/participation-status`, 'participation');
      },
    },
  },
  personaScreens: {
    ceo: ['survey', 'results', 'results-managed', 'trend', 'participation'],
    director: ['survey', 'results', 'results-managed', 'trend', 'participation'],
    lead: ['survey', 'results', 'results-managed', 'trend', 'participation'],
    ic: ['survey', 'results', 'trend'],
    hr: ['survey', 'results', 'trend', 'participation'],
    admin: ['survey', 'results', 'trend'],
  },
};

const sc = defineScenario(def);
export const options = sc.options;
export const setup = sc.setup;
export default sc.default;
export const handleSummary = sc.handleSummary;
