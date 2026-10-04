// k6 scenario `succession`: /succession (pages/SuccessionPlans.tsx, SuccessionPlanTable.tsx, UserSuccessionPlans.tsx,
// api/successionPlans.ts). The nav leaf exists only for managers (SUCCESSION_PLANS flag + managerOnly); an IC / HR / admin
// never reaches it by navigation (a typed URL shows an empty own list), so only managers load the list tabs; HR reaches the
// per-person audit drill-down from a person's details page. Plans exist for managers only (81 owners, ~20 plans each).
//   own      first load: Shell || succession-plans?view=own&page=1&pageSize=20&sort=-lastReviewedAt
//   team     tab click: view=team (plans owned by the caller's reports who manage — a lead's is empty by construction);
//            team-all = includeIndirect=true
//   drilldown-audit  HR on a lead (perf-lead-001): Shell || ONE users?id=<lead> lookup (v4.15.0 — it was the six-page listAll pool) ||
//                    succession-plans?view=user&page=1&pageSize=20&sort=-lastReviewedAt&userId=<lead>
import { defineScenario, qs, shellRequests, SHELL_ENDPOINTS } from './lib/replay.js';

const list = (view, extra = {}) => `/api/v1/succession-plans?${qs(Object.assign({ view, page: 1, pageSize: 20, sort: '-lastReviewedAt' }, extra))}`;
const userLookup = (id) => `/api/v1/users?${qs({ page: 1, pageSize: 1, id })}`;

const def = {
  name: 'succession',
  personas: ['ceo', 'director', 'lead', 'hr'],
  extraLogins: ['lead'],
  screens: {
    own: {
      endpoints: [...SHELL_ENDPOINTS, 'own'],
      run(s) { s.batch([...shellRequests(s), [list('own'), 'own']]); },
    },
    team: { endpoints: ['team'], run(s) { s.get(list('team'), 'team'); } },
    'team-all': { endpoints: ['team'], run(s) { s.get(list('team', { includeIndirect: true }), 'team'); } },
    'drilldown-audit': {
      endpoints: [...SHELL_ENDPOINTS, 'users', 'list'],
      run(s) {
        const id = s.userId('lead');
        s.batch([...shellRequests(s), [userLookup(id), 'users'], [list('user', { userId: id }), 'list']]);
      },
    },
  },
  personaScreens: {
    ceo: ['own', 'team', 'team-all'],
    director: ['own', 'team', 'team-all'],
    lead: ['own', 'team'],
    hr: ['drilldown-audit'],
  },
};

const sc = defineScenario(def);
export const options = sc.options;
export const setup = sc.setup;
export default sc.default;
export const handleSummary = sc.handleSummary;
