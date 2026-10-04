// k6 scenario `mixed-50vu`: the stated peak — 50 concurrent users doing a realistic mix, with think time. Run it as
// `perf/run.sh k6 mixed-50vu --persona mixed --vus 50 --ramp-up 2m --duration 5m --think 3 8` (the shape of the plan: ramp
// 0 -> 50 over 2 min, hold 5 min, 3-8 s think time). VU n takes MIX[(n-1) % 10] (6 IC accounts' worth of ICs, 2 leads, a
// director, the CEO, HR). Each iteration picks ONE action by the plan's weights:
//   60 %  a list / landing screen the persona can reach (the same request replays as the per-screen scenarios, first loads
//         with the Shell): dashboard, feedback received/provided, own 1:1s, the bell drawer, the days-off calendar, own KPIs,
//         own impact log, own activity; managers add the managed 1:1 list, the team feedback list, team days-off, managed KPIs
//   25 %  a detail read: a list, then one row's document (1:1 meeting, feedback, goal)
//   10 %  a WRITE (touches only the perf database; `perf/run.sh restore` before every baseline — `all` restores before AND after
//         this run; the counters `write_<action>_<status>` separate the 201/204s from the 409s):
//         feedback create (DRAFT) + send, 1:1 create with the server-side carry-over (managers), goal progress (NUMBER goals)
//    5 %  a login (anonymous: no Server-Timing)
// Not in the mix: the reviews team view and the other heavy manager screens — they have their own scenarios (a CEO reloading the
// 15-request / 1 190-statement screen every few seconds would drown everything else; add it with `--persona` runs instead).
import { defineScenario, qs, isoDate, shellRequests, SHELL_ENDPOINTS } from './lib/replay.js';
import { Counter } from 'k6/metrics';
import { PERF_PASSWORD, ALL_PERSONAS } from './lib/auth.js';

const MIX = ['ic', 'ic2', 'ic3', 'ic', 'lead', 'lead2', 'ic2', 'director', 'ceo', 'hr'];
const MANAGERS = ['lead', 'lead2', 'director', 'ceo'];
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
const SEND_EXPECT = [204, 409];

const list20 = (path, params) => `${path}?${qs(Object.assign({ page: 1, pageSize: 20 }, params))}`;
// The date of a created 1:1. The server rejects a date EARLIER than the pair's latest meeting (equal is fine), the dataset
// ends at its anchor and nothing caps the future, so the date only has to be non-decreasing in real time: one day per 10
// minutes since a fixed epoch. That holds across a run that crosses UTC midnight and across a second run on the same
// database without a restore (a later run starts later). Barring a clock set backwards, a 409 here means the pair was
// written by something else; it is counted as its own outcome (`write_<action>_409`), never folded into success.
const EPOCH_MS = Date.UTC(2026, 9, 4);
const meetingDate = () => isoDate(0, EPOCH_MS + Math.floor((Date.now() - EPOCH_MS) / 600000) * 86400000);
// One counter per (action, outcome), e.g. `write_1on1_create_201` / `write_1on1_create_409` (root metrics, so every summary carries them).
const OUTCOMES = {};
for (const action of ['feedback_create', 'feedback_send', '1on1_create', 'goal_progress']) {
  for (const status of ['201', '204', '409', 'failed']) OUTCOMES[`${action}_${status}`] = new Counter(`write_${action}_${status}`);
}
const outcome = (action, res) => {
  const status = res === null ? 'failed' : String(res.status);
  (OUTCOMES[`${action}_${status}`] || OUTCOMES[`${action}_failed`]).add(1);
};

function firstId(res) {
  if (res === null) return null;
  const items = res.json().items;
  return items.length ? pick(items).id : null;
}

const SCREENS = {
  // ---- lists ----
  home: {
    endpoints: [...SHELL_ENDPOINTS, 'summary', 'managers'],
    run(s) {
      s.batch([...shellRequests(s), ['/api/v1/dashboard/summary', 'summary'],
        [`/api/v1/teams/members?${qs({ view: 'managers', page: 1, pageSize: 100 })}`, 'managers']]);
    },
  },
  'fb-received': {
    endpoints: [...SHELL_ENDPOINTS, 'list'],
    run(s) { s.batch([...shellRequests(s), [list20('/api/v1/feedbacks', { view: 'received', sort: 'providerName' }), 'list']]); },
  },
  'fb-provided': { endpoints: ['list'], run(s) { s.get(list20('/api/v1/feedbacks', { view: 'provided', sort: 'subjectName' }), 'list'); } },
  'fb-team': { endpoints: ['list'], run(s) { s.get(list20('/api/v1/feedbacks', { view: 'team', sort: 'subjectName' }), 'list'); } },
  'oo-own': {
    endpoints: [...SHELL_ENDPOINTS, 'list'],
    run(s) { s.batch([...shellRequests(s), [list20('/api/v1/one-on-ones', { view: 'own', sort: '-meetingDate' }), 'list']]); },
  },
  'oo-managed': { endpoints: ['list'], run(s) { s.get(list20('/api/v1/one-on-ones', { view: 'managed', sort: '-meetingDate' }), 'list'); } },
  bell: {
    endpoints: ['list'],
    run(s) { s.get(`/api/v1/notifications?${qs({ page: 1, pageSize: 50, sort: '-timestamp' })}`, 'list'); },
  },
  cal: {
    endpoints: [...SHELL_ENDPOINTS, 'calendar'],
    run(s) { s.batch([...shellRequests(s), [`/api/v1/days-off/calendar?${qs({ month: isoDate(0).slice(0, 7), scope: 'member' })}`, 'calendar']]); },
  },
  'team-requests': {
    endpoints: ['list', 'pool-types'],
    run(s) { s.batch([[list20('/api/v1/days-off', { view: 'managed', sort: '-startDate' }), 'list'], ['/api/v1/days-off/pool-types', 'pool-types']]); },
  },
  'kpis-own': {
    endpoints: [...SHELL_ENDPOINTS, 'list'],
    run(s) { s.batch([...shellRequests(s), [list20('/api/v1/team-kpis', { view: 'own', sort: '-createdAt' }), 'list']]); },
  },
  'kpis-managed': { endpoints: ['list'], run(s) { s.get(list20('/api/v1/team-kpis', { view: 'managed', sort: '-createdAt' }), 'list'); } },
  'impact-own': {
    endpoints: [...SHELL_ENDPOINTS, 'list'],
    run(s) { s.batch([...shellRequests(s), [list20('/api/v1/impact-log', { view: 'own', sort: '-periodStart' }), 'list']]); },
  },
  'activity-own': {
    endpoints: [...SHELL_ENDPOINTS, 'list'],
    run(s) { s.batch([...shellRequests(s), [`/api/v1/users/${s.session.userId}/activity?${qs({ page: 1, pageSize: 20, sort: '-createdAt' })}`, 'list']]); },
  },
  // ---- detail reads: a list, then one row's document ----
  'detail-1on1': {
    endpoints: ['list', 'meeting'],
    run(s) {
      const view = MANAGERS.includes(s.persona) ? 'managed' : 'own';
      const id = firstId(s.get(list20('/api/v1/one-on-ones', { view, sort: '-meetingDate' }), 'list'));
      if (id !== null) s.get(`/api/v1/one-on-ones/${id}`, 'meeting');
    },
  },
  'detail-feedback': {
    endpoints: ['list', 'feedback'],
    run(s) {
      const id = firstId(s.get(list20('/api/v1/feedbacks', { view: 'received', sort: 'providerName' }), 'list'));
      if (id !== null) s.get(`/api/v1/feedbacks/${id}`, 'feedback');
    },
  },
  'detail-goal': {
    endpoints: ['list', 'goal'],
    run(s) {
      const view = MANAGERS.includes(s.persona) ? 'managed' : 'own';
      const id = firstId(s.get(list20('/api/v1/goals', { view }), 'list'));
      if (id !== null) s.get(`/api/v1/goals/${id}`, 'goal');
    },
  },
  // ---- writes ----
  'write-feedback': {
    endpoints: ['create', 'send'],
    run(s) {
      // The create screen's flow: a DRAFT, then "send" (EditFeedback does PUT + send; the PUT is a plain row update, left out).
      // Recipients are random perf users 11..521 (never self); a fresh DRAFT per recipient avoids the open-draft 409.
      let subject = 11 + Math.floor(Math.random() * 511);
      if (subject === s.session.userId) subject += 1;
      const res = s.post('/api/v1/feedbacks', {
        subjectId: subject, providerId: s.session.userId, visibility: 'PROVIDER_SUBJECT', status: 'DRAFT',
        content: 'Perf mix feedback: a short, plain paragraph about how a recent project went, long enough to be encrypted and stored.',
      }, 'create', [201, 409]);
      outcome('feedback_create', res);
      if (res !== null && res.status === 201) outcome('feedback_send', s.post(`/api/v1/feedbacks/${res.json().id}/send`, undefined, 'send', SEND_EXPECT));
    },
  },
  'write-1on1': {
    endpoints: ['reports', 'create'],
    run(s) {
      // CreateOneOnOne mount: the manager's transitive reports (listAll, pageSize 100) — then the POST; the server carries over
      // the pair's unresolved action items itself (the SPA sends no carry-over data).
      const reports = s.pageAll((page) => `/api/v1/teams/members?${qs({ view: 'managed', page, pageSize: 100, includeIndirect: true })}`, 'reports');
      if (reports.length === 0) return;
      const r = pick(reports);
      outcome('1on1_create', s.post('/api/v1/one-on-ones', { subordinateId: r.userId, meetingDate: meetingDate(), points: [], decisions: [], actionItems: [] }, 'create', [201, 409]));
    },
  },
  'write-goal': {
    endpoints: ['list', 'progress'],
    run(s) {
      const view = MANAGERS.includes(s.persona) ? 'managed' : 'own';
      const id = firstId(s.get(list20('/api/v1/goals', { view, status: 'ACTIVE', type: 'NUMBER' }), 'list'));
      if (id !== null) outcome('goal_progress', s.send('PUT', `/api/v1/goals/${id}/progress`, { currentValue: Math.round(Math.random() * 1000) / 10, comment: 'perf mix progress' }, 'progress', [204, 409]));
    },
  },
  login: {
    endpoints: ['login'],
    run(s) {
      const p = ALL_PERSONAS[s.persona];
      s.send('POST', '/api/v1/login', { email: p.email, password: p.password || PERF_PASSWORD }, 'login', [200], true);
    },
  },
};

const READS = ['home', 'fb-received', 'fb-provided', 'oo-own', 'bell', 'cal', 'kpis-own', 'impact-own', 'activity-own'];
const MANAGER_READS = ['oo-managed', 'fb-team', 'team-requests', 'kpis-managed'];
const DETAILS = ['detail-1on1', 'detail-feedback', 'detail-goal'];
const NO_GOALS = ['hr', 'admin'];

function actions(persona) {
  const mgr = MANAGERS.includes(persona);
  const noGoals = NO_GOALS.includes(persona);
  return {
    reads: mgr ? READS.concat(MANAGER_READS) : READS,
    details: noGoals ? ['detail-feedback'] : DETAILS,
    writes: ['write-feedback'].concat(mgr ? ['write-1on1'] : []).concat(noGoals ? [] : ['write-goal']),
  };
}

const def = {
  name: 'mixed-50vu',
  personas: MIX,
  screens: SCREENS,
  personaScreens: {},
  iteration(persona) {
    const a = actions(persona);
    const r = Math.random();
    if (r < 0.60) return [pick(a.reads)];
    if (r < 0.85) return [pick(a.details)];
    if (r < 0.95) return [pick(a.writes)];
    return ['login'];
  },
};
for (const p of Object.keys(ALL_PERSONAS)) {
  if (!MIX.includes(p)) continue;
  const a = actions(p);
  def.personaScreens[p] = a.reads.concat(a.details, a.writes, ['login']);
}
def.personas = Array.from(new Set(MIX));
def.vuPersonas = MIX; // the weighted round-robin (repeated entries weight the ICs)

const sc = defineScenario(def);
export const options = sc.options;
export const setup = sc.setup;
export const handleSummary = sc.handleSummary;
export default sc.default;
