// k6 scenario `dashboard`: the landing page `/` (web/src/pages/Dashboard.tsx, DashboardHero.tsx, ManagersTable.tsx,
// TeamMembersTable.tsx, MyTeamsTable.tsx, api/{dashboard,teams,successionPlans}.ts). Run through
// `perf/run.sh k6 dashboard …`. Every persona reaches the page (no gate); the first load of a fresh browser lands on
// the MANAGERS tab (no stored tab), the others fire on a click:
//   first-load       Shell (user, managed-teams probe, alerts, bell badge) || dashboard/summary || teams/members?view=managers
//                    (listAllTeamMembers: pageSize 100, page after page until total)
//   peers-tab        teams (listAllTeams, pageSize 100 sort=name) || teams/members?view=member&pageSize=20&sort=name
//   subordinates-tab (managers only: a persona without reports sees an empty tab) teams || members?view=managed&pageSize=20
//                    &sort=name || succession-plans?view=own&status=OPEN&pageSize=100 (listAll)
//   subordinates-all the same with the stored reports scope "all" (includeIndirect=true) — a manager who picked it once
//   my-teams-tab     teams?pageSize=20&sort=name&managerId=<me>
import { defineScenario, qs, shellRequests, SHELL_ENDPOINTS } from './lib/replay.js';

const PAGE = 20;
const teamsPage = (page) => `/api/v1/teams?${qs({ page, pageSize: 100, sort: 'name' })}`;

const def = {
  name: 'dashboard',
  personas: ['ceo', 'director', 'lead', 'lead2', 'ic', 'hr', 'admin'],
  screens: {
    'first-load': {
      endpoints: [...SHELL_ENDPOINTS, 'summary', 'managers'],
      run(s) {
        s.batch([
          ...shellRequests(s),
          ['/api/v1/dashboard/summary', 'summary'],
          [`/api/v1/teams/members?${qs({ view: 'managers', page: 1, pageSize: 100 })}`, 'managers'],
        ]);
      },
    },
    'peers-tab': {
      endpoints: ['teams-all', 'members-member'],
      run(s) {
        // The members page and listAllTeams' first page are enabled together; the loop's further pages follow.
        const res = s.batch([
          [teamsPage(1), 'teams-all'],
          [`/api/v1/teams/members?${qs({ view: 'member', page: 1, pageSize: PAGE, sort: 'name' })}`, 'members-member'],
        ]);
        s.pageMore(teamsPage, res[0], 'teams-all');
      },
    },
    'subordinates-tab': {
      endpoints: ['teams-all', 'members-managed', 'succession-own'],
      run(s) { subordinates(s, false); },
    },
    'subordinates-all': {
      endpoints: ['teams-all', 'members-managed', 'succession-own'],
      run(s) { subordinates(s, true); },
    },
    'my-teams-tab': {
      endpoints: ['teams-managed'],
      run(s) {
        s.get(`/api/v1/teams?${qs({ page: 1, pageSize: PAGE, sort: 'name', managerId: s.session.userId })}`, 'teams-managed');
      },
    },
  },
  personaScreens: {
    ceo: ['first-load', 'peers-tab', 'subordinates-tab', 'subordinates-all', 'my-teams-tab'],
    director: ['first-load', 'peers-tab', 'subordinates-tab', 'subordinates-all', 'my-teams-tab'],
    lead: ['first-load', 'peers-tab', 'subordinates-tab', 'my-teams-tab'],
    lead2: ['first-load', 'peers-tab', 'subordinates-tab', 'my-teams-tab'],
    ic: ['first-load', 'peers-tab'],
    hr: ['first-load'],
    admin: ['first-load'],
  },
};

function subordinates(s, all) {
  // The three queries of the tab are enabled together (the succession list only with the SUCCESSION_PLANS flag,
  // on for every perf user); the teams loop and the members page are independent chains.
  const res = s.batch([
    [teamsPage(1), 'teams-all'],
    [`/api/v1/teams/members?${qs({ view: 'managed', page: 1, pageSize: PAGE, sort: 'name', includeIndirect: all ? true : undefined })}`, 'members-managed'],
    [`/api/v1/succession-plans?${qs({ view: 'own', status: 'OPEN', page: 1, pageSize: 100 })}`, 'succession-own'],
  ]);
  s.pageMore(teamsPage, res[0], 'teams-all');
}

const sc = defineScenario(def);
export const options = sc.options;
export const setup = sc.setup;
export default sc.default;
export const handleSummary = sc.handleSummary;
