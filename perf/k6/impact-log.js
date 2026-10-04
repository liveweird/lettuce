// k6 scenario `impact-log`: /impact-log (pages/ImpactLog.tsx, ImpactLogTable.tsx, UserImpactLog.tsx, api/impactlog.ts).
// The IMPACT_LOG flag is on for every perf user; the default tab is `own`, `managed` needs isManager. After the Shell the
// page remounts the managed-teams probe once more (staleTime 0) — not replayed twice.
//   own            first load: Shell || impact-log?view=own&page=1&pageSize=20&sort=-periodStart  (all personas; ~58 entries each)
//   managed        tab click (managers): view=managed (direct reports); managed-all = includeIndirect=true (the CEO's: ~510 people)
//   drilldown      /users/<report>/impact-log as the manager: Shell || users (useAllUsers loop) ||
//                  impact-log?view=managed&page=1&pageSize=20&sort=-periodStart&includeIndirect=true&userId=<report>
//   drilldown-audit the HR flavour: view=user&userId=<report> (hr.list audited) || the users loop
import { defineScenario, qs, shellRequests, SHELL_ENDPOINTS } from './lib/replay.js';

const list = (view, extra = {}) => `/api/v1/impact-log?${qs(Object.assign({ view, page: 1, pageSize: 20, sort: '-periodStart' }, extra))}`;
const users = (page) => `/api/v1/users?${qs({ page, pageSize: 100, sort: 'id' })}`;

function drilldown(s, listPath) {
  const res = s.batch([...shellRequests(s), [users(1), 'users'], [listPath, 'list']]);
  s.pageMore(users, res[SHELL_ENDPOINTS.length], 'users');
}

const def = {
  name: 'impact-log',
  personas: ['ceo', 'director', 'lead', 'ic', 'hr', 'admin'],
  extraLogins: ['ic'],
  screens: {
    own: {
      endpoints: [...SHELL_ENDPOINTS, 'own'],
      run(s) { s.batch([...shellRequests(s), [list('own'), 'own']]); },
    },
    managed: { endpoints: ['managed'], run(s) { s.get(list('managed'), 'managed'); } },
    'managed-all': { endpoints: ['managed'], run(s) { s.get(list('managed', { includeIndirect: true }), 'managed'); } },
    drilldown: {
      endpoints: [...SHELL_ENDPOINTS, 'users', 'list'],
      run(s) { drilldown(s, list('managed', { includeIndirect: true, userId: s.userId('ic') })); },
    },
    'drilldown-audit': {
      endpoints: [...SHELL_ENDPOINTS, 'users', 'list'],
      run(s) { drilldown(s, list('user', { userId: s.userId('ic') })); },
    },
  },
  personaScreens: {
    ceo: ['own', 'managed', 'managed-all'],
    director: ['own', 'managed', 'managed-all'],
    lead: ['own', 'managed', 'drilldown'],
    ic: ['own'],
    hr: ['own', 'drilldown-audit'],
    admin: ['own'],
  },
};

const sc = defineScenario(def);
export const options = sc.options;
export const setup = sc.setup;
export default sc.default;
export const handleSummary = sc.handleSummary;
