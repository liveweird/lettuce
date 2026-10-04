// k6 scenario `days-off`: /days-off (pages/DaysOff.tsx, DaysOffTable.tsx, components/DaysOffBudget*.tsx, api/daysoff.ts)
// and the person drill-down (/users/:id/days-off, UserDaysOff.tsx). The DAYS_OFF flag is on for every perf user; the
// default tab is `calendar`, the `team` tab needs isManager, the org calendar scope needs HR. Month and year come
// from the clock (the dataset anchor is 2026-10-01; run within the same year or the budgets read an empty year).
//   calendar          first load: Shell || days-off/calendar?month=<this month>&scope=member (holidays ride in the response)
//   calendar-shared   scope=shared                                  (click)
//   calendar-managed  scope=managed / calendar-managed-all  + includeIndirect=true  (managers; the CEO's spans ~510)
//   calendar-org      scope=org (HR) || teams (listAll, the team picker)
//   requests          tab=requests: budgets?view=own&year || days-off?view=own&pageSize=20&sort=-startDate || pool-types
//   team-requests     tab=team (managers): days-off?view=managed&pageSize=20&sort=-startDate || pool-types; -all = includeIndirect
//   team-budgets      the Budgets sub-view: budgets?view=managed&year (unpaged: one row per (user, pool)); -all = includeIndirect
//   drilldown         /users/<report>/days-off as the manager (lead on perf-ic-0001): ONE users?id= lookup
//                     (v4.15.0 — it was the six-page listAll pool) || budgets?view=managed&year&includeIndirect=true || days-off?view=managed&userId&includeIndirect=true || pool-types
//   drilldown-audit   HR: the users?id= lookup || budgets?view=user&userId || days-off?view=user&userId || pool-types || corrections?userId
import { defineScenario, qs, shellRequests, SHELL_ENDPOINTS, isoDate } from './lib/replay.js';

const MONTH = isoDate(0).slice(0, 7);
const YEAR = parseInt(isoDate(0).slice(0, 4), 10);
const calendar = (extra) => `/api/v1/days-off/calendar?${qs(Object.assign({ month: MONTH }, extra))}`;
const entries = (view, extra = {}) => `/api/v1/days-off?${qs(Object.assign({ view, page: 1, pageSize: 20, sort: '-startDate' }, extra))}`;
const budgets = (view, extra = {}) => `/api/v1/days-off/budgets?${qs(Object.assign({ view, year: YEAR }, extra))}`;
const userLookup = (id) => `/api/v1/users?${qs({ page: 1, pageSize: 1, id })}`;

function drilldown(s, id, requests) {
  s.batch([...shellRequests(s), [userLookup(id), 'users'], ...requests]);
}

const def = {
  name: 'days-off',
  personas: ['ceo', 'director', 'lead', 'ic', 'hr', 'admin'],
  extraLogins: ['ic'],
  screens: {
    calendar: {
      endpoints: [...SHELL_ENDPOINTS, 'calendar'],
      run(s) { s.batch([...shellRequests(s), [calendar({ scope: 'member' }), 'calendar']]); },
    },
    'calendar-shared': { endpoints: ['calendar'], run(s) { s.get(calendar({ scope: 'shared' }), 'calendar'); } },
    'calendar-managed': { endpoints: ['calendar'], run(s) { s.get(calendar({ scope: 'managed' }), 'calendar'); } },
    'calendar-managed-all': {
      endpoints: ['calendar'],
      run(s) { s.get(calendar({ scope: 'managed', includeIndirect: true }), 'calendar'); },
    },
    'calendar-org': {
      endpoints: ['calendar', 'teams-all'],
      run(s) {
        s.batch([[calendar({ scope: 'org' }), 'calendar'], [`/api/v1/teams?${qs({ page: 1, pageSize: 100, sort: 'name' })}`, 'teams-all']]);
      },
    },
    requests: {
      endpoints: ['budgets', 'entries', 'pool-types'],
      run(s) {
        s.batch([[budgets('own'), 'budgets'], [entries('own'), 'entries'], ['/api/v1/days-off/pool-types', 'pool-types']]);
      },
    },
    'team-requests': {
      endpoints: ['entries', 'pool-types'],
      run(s) { s.batch([[entries('managed'), 'entries'], ['/api/v1/days-off/pool-types', 'pool-types']]); },
    },
    'team-requests-all': {
      endpoints: ['entries', 'pool-types'],
      run(s) { s.batch([[entries('managed', { includeIndirect: true }), 'entries'], ['/api/v1/days-off/pool-types', 'pool-types']]); },
    },
    'team-budgets': { endpoints: ['budgets'], run(s) { s.get(budgets('managed'), 'budgets'); } },
    'team-budgets-all': { endpoints: ['budgets'], run(s) { s.get(budgets('managed', { includeIndirect: true }), 'budgets'); } },
    drilldown: {
      endpoints: [...SHELL_ENDPOINTS, 'users', 'budgets', 'entries', 'pool-types'],
      run(s) {
        const id = s.userId('ic');
        drilldown(s, id, [
          [budgets('managed', { includeIndirect: true }), 'budgets'],
          [entries('managed', { userId: id, includeIndirect: true }), 'entries'],
          ['/api/v1/days-off/pool-types', 'pool-types'],
        ]);
      },
    },
    'drilldown-audit': {
      endpoints: [...SHELL_ENDPOINTS, 'users', 'budgets', 'entries', 'pool-types', 'corrections'],
      run(s) {
        const id = s.userId('ic');
        drilldown(s, id, [
          [budgets('user', { userId: id }), 'budgets'],
          [entries('user', { userId: id }), 'entries'],
          ['/api/v1/days-off/pool-types', 'pool-types'],
          [`/api/v1/days-off/corrections?${qs({ userId: id })}`, 'corrections'],
        ]);
      },
    },
  },
  personaScreens: {
    ceo: ['calendar', 'calendar-shared', 'calendar-managed', 'calendar-managed-all', 'requests', 'team-requests', 'team-requests-all', 'team-budgets', 'team-budgets-all'],
    director: ['calendar', 'calendar-shared', 'calendar-managed', 'calendar-managed-all', 'requests', 'team-requests', 'team-requests-all', 'team-budgets', 'team-budgets-all'],
    lead: ['calendar', 'calendar-shared', 'calendar-managed', 'requests', 'team-requests', 'team-budgets', 'drilldown'],
    ic: ['calendar', 'calendar-shared', 'requests'],
    hr: ['calendar', 'calendar-shared', 'calendar-org', 'requests', 'drilldown-audit'],
    admin: ['calendar', 'calendar-shared', 'requests'],
  },
};

const sc = defineScenario(def);
export const options = sc.options;
export const setup = sc.setup;
export default sc.default;
export const handleSummary = sc.handleSummary;
