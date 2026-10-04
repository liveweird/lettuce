// k6 scenario `activity-log`: the per-user activity log (pages/ActivityLog.tsx, UserActivity.tsx,
// components/ActivityFeed.tsx, api/activity.ts). No feature gate and no client role gate; the server decides access
// (self | HR | a manager in the target's transitive chain; an ADMIN as such gets 403 for anybody else).
//   own     /activity — Shell || users/<me>/activity?page=1&pageSize=20&sort=-createdAt; when a row is a
//           CAREER_POSITION the SPA then loads the three career dictionaries (replayed on the same condition)
//   report  /users/<id>/activity as a manager (the chain rule): Shell || users (useUserDisplayName -> useAllUsers:
//           pageSize 100 sort=id, one sequential listAll loop) || users/<id>/activity — the report is perf-ic-0001
//           (id 92; its chain is lead-001 -> dir-01 -> CEO, so lead, director and CEO may all read it)
//   audit   the same page as HR (?mode=audit changes nothing in the API calls) on the CEO — the widest log of the
//           org (hr.list is audited; the UNION ALL runs over every event trail the CEO acted in)
import { defineScenario, qs, shellRequests, SHELL_ENDPOINTS } from './lib/replay.js';

const feed = (id) => `/api/v1/users/${id}/activity?${qs({ page: 1, pageSize: 20, sort: '-createdAt' })}`;
const DICTIONARIES = ['career-paths', 'career-specializations', 'seniority-levels'];

function dictionariesIfCareer(s, res) {
  if (res !== null && res.json().items.some((r) => r.area === 'CAREER_POSITION')) {
    s.batch(DICTIONARIES.map((d) => [`/api/v1/dictionaries/${d}`, 'dictionaries']));
  }
}

function anotherPersonsLog(s, targetId) {
  const users = (page) => `/api/v1/users?${qs({ page, pageSize: 100, sort: 'id' })}`;
  const res = s.batch([...shellRequests(s), [users(1), 'users'], [feed(targetId), 'activity']]);
  s.pageMore(users, res[SHELL_ENDPOINTS.length], 'users');
  dictionariesIfCareer(s, res[SHELL_ENDPOINTS.length + 1]);
}

const def = {
  name: 'activity-log',
  personas: ['ceo', 'director', 'lead', 'ic', 'hr', 'admin'],
  extraLogins: ['ic', 'ceo'],
  screens: {
    own: {
      endpoints: [...SHELL_ENDPOINTS, 'activity', 'dictionaries'],
      run(s) {
        const res = s.batch([...shellRequests(s), [feed(s.session.userId), 'activity']]);
        dictionariesIfCareer(s, res[SHELL_ENDPOINTS.length]);
      },
    },
    report: {
      endpoints: [...SHELL_ENDPOINTS, 'users', 'activity', 'dictionaries'],
      run(s) { anotherPersonsLog(s, s.userId('ic')); },
    },
    audit: {
      endpoints: [...SHELL_ENDPOINTS, 'users', 'activity', 'dictionaries'],
      run(s) { anotherPersonsLog(s, s.userId('ceo')); },
    },
  },
  personaScreens: {
    ceo: ['own', 'report'],
    director: ['own', 'report'],
    lead: ['own', 'report'],
    ic: ['own'],
    hr: ['own', 'audit'],
    admin: ['own'],
  },
};

const sc = defineScenario(def);
export const options = sc.options;
export const setup = sc.setup;
export default sc.default;
export const handleSummary = sc.handleSummary;
