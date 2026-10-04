// k6 scenario `users-admin`: the admin's directory screens — /users (pages/Users.tsx), /teams (Teams.tsx) and the org
// chart /org (OrgChart.tsx). None is role-gated in the SPA (the lists are open to every authenticated user; only the
// buttons and row menus are admin-only), so the admin persona and an IC load them; the CEO adds the org chart.
//   users          first load: Shell || users?page=1&pageSize=20&sort=name
//   users-filtered the name filter (300 ms debounce): users?page=1&pageSize=20&sort=name&name=perf-lead
//   users-deep     a deep page sorted by email: page=20&sort=email   (OFFSET cost)
//   teams          Shell || teams?page=1&pageSize=20&sort=name || users (useManagerOptions -> useAllUsers: pageSize 100
//                  sort=id, one sequential loop of 6 pages)
//   org-chart      /org: Shell || teams page 1 (listAll, pageSize 100 sort=name; rows carry memberIds since v4.14.0 — no
//                  per-team GET) || users page 1 (listAll, pageSize 100 sort=id) in one batch, then both loops' further pages
import { defineScenario, qs, shellRequests, SHELL_ENDPOINTS } from './lib/replay.js';

const usersPage = (page, extra = {}) => `/api/v1/users?${qs(Object.assign({ page, pageSize: 20, sort: 'name' }, extra))}`;
const usersAll = (page) => `/api/v1/users?${qs({ page, pageSize: 100, sort: 'id' })}`;

const teamsPage = (page) => `/api/v1/teams?${qs({ page, pageSize: 100, sort: 'name' })}`;

const def = {
  name: 'users-admin',
  personas: ['admin', 'ic', 'ceo'],
  screens: {
    users: {
      endpoints: [...SHELL_ENDPOINTS, 'users'],
      run(s) { s.batch([...shellRequests(s), [usersPage(1), 'users']]); },
    },
    'users-filtered': { endpoints: ['users'], run(s) { s.get(usersPage(1, { name: 'perf-lead' }), 'users'); } },
    'users-deep': { endpoints: ['users'], run(s) { s.get(usersPage(20, { sort: 'email' }), 'users'); } },
    teams: {
      endpoints: [...SHELL_ENDPOINTS, 'teams', 'users-all'],
      run(s) {
        const res = s.batch([
          ...shellRequests(s),
          [`/api/v1/teams?${qs({ page: 1, pageSize: 20, sort: 'name' })}`, 'teams'],
          [usersAll(1), 'users-all'],
        ]);
        s.pageMore(usersAll, res[SHELL_ENDPOINTS.length + 1], 'users-all');
      },
    },
    'org-chart': {
      endpoints: [...SHELL_ENDPOINTS, 'teams-all', 'users-all'],
      run(s) {
        // OrgChart.fetchOrg: Promise.all([listAllTeams(), listAllUsers()]) beside the Shell's queries — page 1 of both
        // goes out in one batch, each loop then pages on (two loops in the browser; sequential here).
        const first = s.batch([...shellRequests(s), [teamsPage(1), 'teams-all'], [usersAll(1), 'users-all']]);
        s.pageMore(teamsPage, first[SHELL_ENDPOINTS.length], 'teams-all');
        s.pageMore(usersAll, first[SHELL_ENDPOINTS.length + 1], 'users-all');
      },
    },
  },
  personaScreens: {
    admin: ['users', 'users-filtered', 'users-deep', 'teams', 'org-chart'],
    ic: ['users', 'teams', 'org-chart'],
    ceo: ['org-chart'],
  },
};

const sc = defineScenario(def);
export const options = sc.options;
export const setup = sc.setup;
export default sc.default;
export const handleSummary = sc.handleSummary;
