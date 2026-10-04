// k6 scenario `feedback-lists`: Feedback (/feedback, pages/Feedback.tsx, FeedbackTable.tsx, api/feedbacks.ts) and
// Kudos (/kudos, pages/Kudos.tsx). The FEEDBACKS flag is on for every perf user; the page's default tab is
// `received` (also for managers); the `team` tab exists only for isManager (the shell probe).
//   received      first load: Shell || feedbacks?view=received&page=1&pageSize=20&sort=providerName   (all personas)
//   provided      tab click:  feedbacks?view=provided&...&sort=subjectName
//   team          tab click (managers): feedbacks?view=team&...&sort=subjectName   (direct reports)
//   team-all      the same with the stored reports scope "all" (includeIndirect=true)
//   kudos         /kudos: first load = Shell || feedbacks?view=kudos&page=1&pageSize=20&sort=-lastModified, then ONE scroll page
import { defineScenario, qs, shellRequests, SHELL_ENDPOINTS } from './lib/replay.js';

const page20 = (view, sort, extra = {}) => `/api/v1/feedbacks?${qs(Object.assign({ view, page: 1, pageSize: 20, sort }, extra))}`;

const def = {
  name: 'feedback-lists',
  personas: ['ceo', 'director', 'lead', 'ic', 'hr', 'admin'],
  screens: {
    received: {
      endpoints: [...SHELL_ENDPOINTS, 'received'],
      run(s) { s.batch([...shellRequests(s), [page20('received', 'providerName'), 'received']]); },
    },
    provided: {
      endpoints: ['provided'],
      run(s) { s.get(page20('provided', 'subjectName'), 'provided'); },
    },
    team: {
      endpoints: ['team'],
      run(s) { s.get(page20('team', 'subjectName'), 'team'); },
    },
    'team-all': {
      endpoints: ['team'],
      run(s) { s.get(page20('team', 'subjectName', { includeIndirect: true }), 'team'); },
    },
    kudos: {
      endpoints: [...SHELL_ENDPOINTS, 'kudos'],
      run(s) {
        const first = s.batch([...shellRequests(s), [page20('kudos', '-lastModified'), 'kudos']]).pop();
        // useInfiniteQuery: the next page is requested while the sentinel is visible and more rows exist.
        if (first !== null && first.json().total > 20) s.get(page20('kudos', '-lastModified', { page: 2 }), 'kudos');
      },
    },
  },
  personaScreens: {
    ceo: ['received', 'provided', 'team', 'team-all', 'kudos'],
    director: ['received', 'provided', 'team', 'team-all', 'kudos'],
    lead: ['received', 'provided', 'team', 'kudos'],
    ic: ['received', 'provided', 'kudos'],
    hr: ['received', 'provided', 'kudos'],
    admin: ['received', 'provided', 'kudos'],
  },
};

const sc = defineScenario(def);
export const options = sc.options;
export const setup = sc.setup;
export default sc.default;
export const handleSummary = sc.handleSummary;
