// k6 scenario `one-on-ones`: /one-on-ones (pages/OneOnOnes.tsx, OneOnOneTable.tsx, ViewOneOnOne.tsx,
// OneOnOneHistory.tsx, ActionItemHistoryModal.tsx, api/oneonones.ts) and the per-person drill-down
// (/users/:id/one-on-ones, ManagerOneOnOnes). The ONE_ON_ONES flag is on for every perf user. The page's default tab is
// `own` — also for managers; the `managed` and `team` tabs (and their tab buttons) exist only for isManager (the shell
// probe), so IC / HR / admin only ever load `own`. HR's auditor view lives in the drill-down (`?mode=audit`).
//   own            first load: Shell || one-on-ones?view=own&page=1&pageSize=20&sort=-meetingDate
//   managed        tab click:  view=managed (same paging/sort)
//   managed-latest the FilterPanel switch "latest only" (latestOnly=true) — the per-pair summary
//   team / team-all view=team (direct reports as managers) / with the stored scope "all" (includeIndirect=true)
//   detail-chain   /one-on-ones/:id/view: Shell || GET {id}, then the History tab (GET {id}/events) and the history
//                  icon of an action item (GET action-items/{item}/history). The meeting is the one holding the
//                  DEEPEST carry-over chain of dataset v2 (6 links; ids pinned below — a new DATASET_VERSION needs a
//                  re-pick: recursive CTE over one_on_one_action_items.copied_from_id), read by the CEO via the chain rule.
//   drilldown      /users/:id/one-on-ones as the report's manager: Shell || users (useAllUsers: pageSize 100 sort=id,
//                  listAll — one sequential loop) || one-on-ones?view=with&counterpartId=<report>
//   drilldown-audit the same for HR with ?mode=audit: view=user&userId=<report>
import { defineScenario, qs, shellRequests, SHELL_ENDPOINTS } from './lib/replay.js';

// Dataset v2 (seed 1, scale 1.0; re-derived after the fidelity reseed 2026-10-04 — ids are unchanged): meeting 97111 (manager 42 -> subordinate 222, 2025-05-30), action item 314699 (the
// head of a 6-link chain). Pinned, not searched — the search is a recursive query over 430k rows.
const LONG_CHAIN_MEETING = 97111;
const LONG_CHAIN_ITEM = 314699;

const list = (view, extra = {}) => `/api/v1/one-on-ones?${qs(Object.assign({ view, page: 1, pageSize: 20, sort: '-meetingDate' }, extra))}`;

function drilldown(s, listPath) {
  const users = (page) => `/api/v1/users?${qs({ page, pageSize: 100, sort: 'id' })}`;
  const res = s.batch([...shellRequests(s), [users(1), 'users'], [listPath, 'list']]);
  s.pageMore(users, res[SHELL_ENDPOINTS.length], 'users');
}

const def = {
  name: 'one-on-ones',
  personas: ['ceo', 'director', 'lead', 'lead2', 'ic', 'hr', 'admin'],
  extraLogins: ['ic'],
  screens: {
    own: {
      endpoints: [...SHELL_ENDPOINTS, 'own'],
      run(s) { s.batch([...shellRequests(s), [list('own'), 'own']]); },
    },
    managed: { endpoints: ['managed'], run(s) { s.get(list('managed'), 'managed'); } },
    'managed-latest': { endpoints: ['managed'], run(s) { s.get(list('managed', { latestOnly: true }), 'managed'); } },
    team: { endpoints: ['team'], run(s) { s.get(list('team'), 'team'); } },
    'team-all': { endpoints: ['team'], run(s) { s.get(list('team', { includeIndirect: true }), 'team'); } },
    'detail-chain': {
      endpoints: [...SHELL_ENDPOINTS, 'meeting', 'events', 'item-history'],
      run(s) {
        s.batch([...shellRequests(s), [`/api/v1/one-on-ones/${LONG_CHAIN_MEETING}`, 'meeting']]);
        s.get(`/api/v1/one-on-ones/${LONG_CHAIN_MEETING}/events`, 'events');
        s.get(`/api/v1/one-on-ones/action-items/${LONG_CHAIN_ITEM}/history`, 'item-history');
      },
    },
    drilldown: {
      endpoints: [...SHELL_ENDPOINTS, 'users', 'list'],
      run(s) { drilldown(s, list('with', { counterpartId: s.userId('ic') })); },
    },
    'drilldown-audit': {
      endpoints: [...SHELL_ENDPOINTS, 'users', 'list'],
      run(s) { drilldown(s, list('user', { userId: s.userId('ic') })); },
    },
  },
  personaScreens: {
    ceo: ['own', 'managed', 'managed-latest', 'team', 'team-all', 'detail-chain'],
    director: ['own', 'managed', 'managed-latest', 'team', 'team-all'],
    lead: ['own', 'managed', 'managed-latest', 'team', 'drilldown'],
    lead2: ['own', 'managed', 'managed-latest', 'team'],
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
