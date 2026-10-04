// k6 scenario `team-kpis`: /team-kpis (pages/MyTeamKpis.tsx, TeamKpiTable.tsx, ViewTeamKpi.tsx, api/teamkpis.ts). The
// TEAM_KPIS flag is on for every perf user; the default tab is `own`, `managed` needs isManager, `all` needs HR.
//   own        first load: Shell || team-kpis?view=own&page=1&pageSize=20&sort=-createdAt || teams (listAll, the Team
//              filter's options: pageSize 100 sort=name — page 1 in the batch, the rest sequential)
//   managed    tab click (managers): view=managed (direct reports' teams) || teams listAll (refetched, staleTime 0);
//              managed-all = includeIndirect=true
//   all        tab click (HR): view=all (org-wide, hr.list audited) || teams listAll
//   detail     a list row's view page: GET team-kpis/<first id of the persona's list>, then the Data tab (GET .../values)
//              and the History tab (GET .../events). The list is the persona's own landing view (managed for managers,
//              all for HR, own otherwise), its request counted as part of the navigation.
import { defineScenario, qs, shellRequests, SHELL_ENDPOINTS } from './lib/replay.js';

const list = (view, extra = {}) => `/api/v1/team-kpis?${qs(Object.assign({ view, page: 1, pageSize: 20, sort: '-createdAt' }, extra))}`;
const teams = (page) => `/api/v1/teams?${qs({ page, pageSize: 100, sort: 'name' })}`;
function tab(s, listPath) {
  const res = s.batch([[listPath, 'list'], [teams(1), 'teams-all']]);
  s.pageMore(teams, res[1], 'teams-all');
}
const LANDING = { ceo: 'managed', director: 'managed', lead: 'managed', hr: 'all' };

const def = {
  name: 'team-kpis',
  personas: ['ceo', 'director', 'lead', 'ic', 'hr', 'admin'],
  screens: {
    own: {
      endpoints: [...SHELL_ENDPOINTS, 'list', 'teams-all'],
      run(s) {
        const res = s.batch([...shellRequests(s), [list('own'), 'list'], [teams(1), 'teams-all']]);
        s.pageMore(teams, res[SHELL_ENDPOINTS.length + 1], 'teams-all');
      },
    },
    // Every tab remounts TeamKpiTable, whose listAllTeams (the Team filter's options, staleTime 0) refetches with the list.
    managed: { endpoints: ['list', 'teams-all'], run(s) { tab(s, list('managed')); } },
    'managed-all': { endpoints: ['list', 'teams-all'], run(s) { tab(s, list('managed', { includeIndirect: true })); } },
    all: { endpoints: ['list', 'teams-all'], run(s) { tab(s, list('all')); } },
    detail: {
      endpoints: [...SHELL_ENDPOINTS, 'list', 'kpi', 'values', 'events'],
      run(s) {
        const res = s.get(list(LANDING[s.persona] || 'own'), 'list');
        if (res === null || res.json().items.length === 0) return;
        const id = res.json().items[0].id;
        s.batch([...shellRequests(s), [`/api/v1/team-kpis/${id}`, 'kpi']]);
        s.get(`/api/v1/team-kpis/${id}/values`, 'values');
        s.get(`/api/v1/team-kpis/${id}/events`, 'events');
      },
    },
  },
  personaScreens: {
    ceo: ['own', 'managed', 'managed-all', 'detail'],
    director: ['own', 'managed', 'managed-all', 'detail'],
    lead: ['own', 'managed', 'detail'],
    ic: ['own', 'detail'],
    hr: ['own', 'all', 'detail'],
    admin: ['own'],
  },
};

const sc = defineScenario(def);
export const options = sc.options;
export const setup = sc.setup;
export default sc.default;
export const handleSummary = sc.handleSummary;
