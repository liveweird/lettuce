// k6 scenario `users-admin`: the admin's directory screens — /users (pages/Users.tsx), /teams (Teams.tsx) and the org
// chart /org (OrgChart.tsx). None is role-gated in the SPA (the lists are open to every authenticated user; only the
// buttons and row menus are admin-only), so the admin persona and an IC load them; the CEO adds the org chart.
//   users          first load: Shell || users?page=1&pageSize=20&sort=name
//   users-filtered the name filter (300 ms debounce): users?page=1&pageSize=20&sort=name&name=perf-lead
//   users-deep     a deep page sorted by email: page=20&sort=email   (OFFSET cost)
//   teams          Shell || teams?page=1&pageSize=20&sort=name || users (useManagerOptions -> useAllUsers: pageSize 100
//                  sort=id, one sequential loop of 6 pages)
//   org-chart      /org: Shell || teams (listAll, pageSize 100 sort=name), THEN Promise.all: one GET teams/<id> per team (84)
//                  and the users listAll loop, all in one http.batch (k6 sends 6 at a time, the browser's own connection cap)
import { defineScenario, qs, shellRequests, SHELL_ENDPOINTS } from './lib/replay.js';

const usersPage = (page, extra = {}) => `/api/v1/users?${qs(Object.assign({ page, pageSize: 20, sort: 'name' }, extra))}`;
const usersAll = (page) => `/api/v1/users?${qs({ page, pageSize: 100, sort: 'id' })}`;

const teamsPage = (page) => `/api/v1/teams?${qs({ page, pageSize: 100, sort: 'name' })}`;
// Per-VU state: how many `users` pages of 100 the previous org-chart load found (0/1 until the first load ran).
let usersPages = 1;

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
      endpoints: [...SHELL_ENDPOINTS, 'teams-all', 'team', 'users-all'],
      run(s) {
        // The Shell's queries mount with the page: teams page 1 goes out beside them.
        const first = s.batch([...shellRequests(s), [teamsPage(1), 'teams-all']]);
        const teams = s.pageMore(teamsPage, first[SHELL_ENDPOINTS.length], 'teams-all');
        // OrgChart.fetchOrg: Promise.all([...one GET per team, listAllUsers()]). listAllUsers pages one after the other in
        // the browser; here pages 2..N join the same batch (N learned from this VU's previous load — the first load of a
        // VU has to take pages 2+ after the batch) so they overlap the team GETs instead of trailing them.
        const per = teams.map((t) => [`/api/v1/teams/${t.id}`, 'team']);
        const extra = [];
        for (let page = 2; page <= usersPages; page += 1) extra.push([usersAll(page), 'users-all']);
        const res = s.batch([...per, [usersAll(1), 'users-all'], ...extra]);
        const total = res[per.length] === null ? 0 : res[per.length].json().total;
        usersPages = Math.max(1, Math.ceil(total / 100));
        if (extra.length === 0) s.pageMore(usersAll, res[per.length], 'users-all');
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
