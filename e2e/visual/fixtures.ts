import { test as base, expect } from '@playwright/test';
import type { components } from '../../web/src/api/schema';
import { APP_VERSION } from '../../web/src/changelog/version';
import { sessionEntries } from '../sessions';
import { cardPeople, dashboardSummary, people, teams } from './people-fixtures';

type Schema = components['schemas'];
type Options = { visualRole: 'member' | 'admin' | 'manager'; visualLanguage: 'en' | 'pl'; visualScenario: 'lists' | 'people' };
const userId = 7001;
const userName = 'Aleksandra Kowalska-Nowak';
const fixedTime = Date.parse('2026-10-03T12:00:00Z');

export const dictionary = {
  items: [
    { id: 101, values: { en: 'Engineering', pl: 'Inżynieria' } },
    { id: 102, values: { en: 'Platform reliability and international customer experience engineering', pl: 'Niezawodność platformy i rozwój międzynarodowej obsługi klientów' } },
    { id: 103, values: { en: 'Product research, accessibility and inclusive service design', pl: 'Badania produktu, dostępność i projektowanie usług' } },
    { id: 104, values: { en: 'Operations' } },
  ],
} satisfies Schema['DictionaryEntryList'];

function row(id: number, overrides: Partial<Schema['FeedbackListItem']>): Schema['FeedbackListItem'] {
  return {
    id, requesterId: null, requesterName: null, requesterDeleted: false,
    subjectId: userId, subjectName: userName, subjectDeleted: false,
    subjects: [{ id: userId, name: userName, deleted: false }],
    providerId: 7100 + id,
    providerName: 'Christopher Montgomery-Wellington', providerDeleted: false,
    visibility: 'PROVIDER_SUBJECT', status: 'SENT',
    contentPreview: 'Clear communication and thoughtful collaboration across the international platform migration.',
    lastModified: fixedTime - id * 86_400_000,
    ...overrides,
  };
}

export const received = [
  row(1, {}),
  row(2, { providerName: 'Joanna Wiśniewska', visibility: 'PUBLIC', subjects: [
    { id: userId, name: userName, deleted: false },
    { id: 7201, name: 'Maximilian Alexander von Hohenberg', deleted: false },
    { id: 7202, name: 'Konstantyna Brzęczyszczykiewicz', deleted: false },
    { id: 7203, name: 'Alexandra Fernández de la Cruz', deleted: false },
  ] }),
  row(3, { providerName: 'Thomas Anderson', requesterId: 7301,
    requesterName: 'Elizabeth Rutherford-Hamilton', visibility: 'PROVIDER_REQUESTER_SUBJECT' }),
];

export const provided = (['SENT', 'DRAFT', 'REQUESTED', 'WITHDRAWN'] as const).map((status, index) =>
  row(index + 11, {
    providerId: userId, providerName: userName,
    subjectId: 7201, subjectName: 'Maximilian Alexander von Hohenberg',
    subjects: [{ id: 7201, name: 'Maximilian Alexander von Hohenberg', deleted: false },
      ...(status === 'SENT' ? received[1].subjects.filter((person) => person.id !== userId && person.id !== 7201) : [])],
    status,
    ...(status === 'REQUESTED' ? { requesterId: 7301, requesterName: 'Elizabeth Rutherford-Hamilton',
      visibility: 'PROVIDER_REQUESTER_SUBJECT' as const, expiresOn: '2026-10-20', contentPreview: '' } : {}),
  }),
);

export const test = base.extend<Options>({
  visualRole: ['member', { option: true }],
  visualLanguage: ['en', { option: true }],
  visualScenario: ['lists', { option: true }],
  page: async ({ page, context, visualRole, visualLanguage, visualScenario, colorScheme }, use) => {
    const unexpected: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const roles: Schema['UserResponse']['roles'] = visualRole === 'admin' ? ['ADMIN'] : [];
    const user = {
      id: userId, name: userName, email: 'visual-fixture@example.invalid', roles,
      careerPath: null, careerSpecialization: null, seniorityLevel: null,
      deactivated: false, disabledFeatures: [], emailNotificationsEnabled: false,
      uniqueId: null, language: visualLanguage, lastLoginAt: fixedTime,
    } satisfies Schema['UserResponse'];
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const reject = async () => {
        unexpected.push(`${request.method()} ${url.origin}${url.pathname}${url.search}`);
        await route.abort('blockedbyclient');
      };
      if (url.origin !== 'http://127.0.0.1:5197') return reject();
      if (!/^\/api(?:\/|$)/.test(url.pathname)) return route.continue();
      if (request.method() !== 'GET') return reject();
      let body: unknown;
      if (url.pathname === `/api/v1/users/${userId}`) body = user;
      else if (url.pathname === '/api/v1/teams' && url.searchParams.get('managerId') === String(userId)) {
        const items = visualRole === 'manager' ? [{ ...teams[0], managerId: userId, managerName: userName }] : [];
        body = { items, page: 1, pageSize: 1, total: items.length } satisfies Schema['TeamPage'];
      } else if (url.pathname === '/api/v1/alerts/visible') body = { items: [] };
      else if (url.pathname === '/api/v1/notifications') {
        body = { items: [], page: 1, pageSize: 1, total: 0 } satisfies Schema['NotificationPage'];
      } else if (/^\/api\/v1\/dictionaries\/(career-paths|career-specializations|seniority-levels|pulse-rotating-questions)$/.test(url.pathname)) {
        body = dictionary;
      } else if (url.pathname === '/api/v1/feedbacks') {
        const view = url.searchParams.get('view');
        if (!['received', 'provided'].includes(view ?? '') || url.searchParams.get('page') !== '1') return reject();
        const items = view === 'received' ? received : provided;
        body = { items, page: 1, pageSize: Number(url.searchParams.get('pageSize')), total: items.length } satisfies Schema['FeedbackPage'];
      } else if (visualScenario === 'people' && url.pathname === '/api/v1/dashboard/summary') {
        body = dashboardSummary(visualRole === 'manager');
      } else if (visualScenario === 'people' && url.pathname === '/api/v1/users' && url.searchParams.get('page') === '1') {
        body = { items: people, page: 1, pageSize: Number(url.searchParams.get('pageSize')), total: people.length } satisfies Schema['UserPage'];
      } else if (visualScenario === 'people' && url.pathname === '/api/v1/teams' && url.searchParams.get('page') === '1') {
        body = { items: teams, page: 1, pageSize: Number(url.searchParams.get('pageSize')), total: teams.length } satisfies Schema['TeamPage'];
      } else if (visualScenario === 'people' && url.pathname === '/api/v1/teams/members' && url.searchParams.get('page') === '1') {
        const view = url.searchParams.get('view');
        if (view !== (visualRole === 'manager' ? 'managed' : 'managers')) return reject();
        const items = cardPeople(visualRole === 'manager');
        body = { items, page: 1, pageSize: Number(url.searchParams.get('pageSize')), total: items.length } satisfies Schema['TeamMemberPage'];
      } else if (visualScenario === 'people' && visualRole === 'manager' && url.pathname === '/api/v1/succession-plans'
        && url.searchParams.get('view') === 'own' && url.searchParams.get('status') === 'OPEN' && url.searchParams.get('page') === '1') {
        body = { items: [], page: 1, pageSize: 100, total: 0 } satisfies Schema['SuccessionPlanPage'];
      } else return reject();
      await route.fulfill({ status: 200, json: body });
    });
    await page.clock.setFixedTime(new Date(fixedTime));
    await page.addInitScript(({ entries, language, scheme, version, id }) => {
      for (const [key, value] of entries) localStorage.setItem(key, value);
      localStorage.setItem('lettuce.lang', language);
      localStorage.setItem('mantine-color-scheme-value', scheme);
      localStorage.setItem('lettuce.viewSettings.appShell.navCollapsed', 'false');
      localStorage.setItem(`lettuce.tour.seen.${id}`, '1');
      localStorage.setItem('lettuce.changelog', JSON.stringify({ seenVersion: version }));
    }, {
      entries: sessionEntries({ token: 'visual-only-not-a-credential', refreshToken: 'visual-only', roles, userId }),
      language: visualLanguage, scheme: colorScheme === 'dark' ? 'dark' : 'light', version: APP_VERSION, id: userId,
    });
    await use(page);
    expect(unexpected, 'Every API request must be an explicit fixture; no live backend fallback').toEqual([]);
    expect(errors, 'The real SPA must render without uncaught errors').toEqual([]);
  },
});

export { expect };
