import type { components } from '../../web/src/api/schema';

type Schema = components['schemas'];

export const FORM_USER_ID = 7001;
export const DRAFT_FEEDBACK_ID = 501;
export const SENT_FEEDBACK_ID = 502;
export const FORM_TEAM_ID = 601;
export const RELATIONSHIP_USER_ID = 7101;

const careerPath = { id: 801, values: { en: 'Engineering', pl: 'Inżynieria' } };
const specialization = { id: 802, values: { en: 'Platform reliability', pl: 'Niezawodność platformy' } };
const seniority = { id: 803, values: { en: 'Senior', pl: 'Starszy/a' } };

export const formUsers = [
  {
    id: FORM_USER_ID, name: 'Aleksandra Kowalska-Nowak', email: 'visual-fixture@example.invalid',
    roles: [], careerPath, careerSpecialization: specialization, seniorityLevel: seniority,
    deactivated: false, teams: [{ id: 602, name: 'International Experience' }],
    disabledFeatures: [], emailNotificationsEnabled: false, uniqueId: 'EMP-7001', language: 'en',
    lastLoginAt: Date.parse('2026-10-03T09:15:00Z'),
  },
  {
    id: RELATIONSHIP_USER_ID, name: 'Maximilian Alexander von Hohenberg', email: 'maximilian@example.invalid',
    roles: [], careerPath, careerSpecialization: specialization, seniorityLevel: seniority,
    deactivated: false, teams: [
      { id: FORM_TEAM_ID, name: 'Customer Platform & Reliability' },
      { id: 602, name: 'International Experience' },
    ], disabledFeatures: [], emailNotificationsEnabled: true, uniqueId: 'EMP-7101', language: 'en',
    lastLoginAt: Date.parse('2026-10-02T08:30:00Z'),
  },
  {
    id: 7102, name: 'Konstantyna Brzęczyszczykiewicz', email: 'konstantyna@example.invalid',
    roles: [], careerPath, careerSpecialization: null, seniorityLevel: { id: 804, values: { en: 'Principal' } },
    deactivated: false, teams: [{ id: FORM_TEAM_ID, name: 'Customer Platform & Reliability' }],
    disabledFeatures: [], emailNotificationsEnabled: true, uniqueId: 'EMP-7102', language: 'pl',
    lastLoginAt: Date.parse('2026-10-01T15:00:00Z'),
  },
  {
    id: 7103, name: 'Alexandra Fernández de la Cruz', email: 'alexandra@example.invalid',
    roles: [], careerPath: null, careerSpecialization: null, seniorityLevel: null,
    deactivated: false, teams: [{ id: 602, name: 'International Experience' }],
    disabledFeatures: [], emailNotificationsEnabled: true, uniqueId: null, language: 'en', lastLoginAt: null,
  },
] satisfies Schema['UserResponse'][];

export const templates = {
  items: [
    { id: 901, name: 'Growth feedback', contentPreview: 'What went well, impact and next step.' },
    { id: 902, name: 'Project retrospective', contentPreview: 'Outcome, collaboration and learning.' },
  ], page: 1, pageSize: 100, total: 2,
} satisfies Schema['TemplatePage'];

export const draftFeedback = {
  id: DRAFT_FEEDBACK_ID,
  requesterId: null,
  requesterName: null,
  subjectId: RELATIONSHIP_USER_ID,
  subjectName: 'Maximilian Alexander von Hohenberg',
  subjects: [
    { id: RELATIONSHIP_USER_ID, name: 'Maximilian Alexander von Hohenberg', deleted: false },
    { id: 7102, name: 'Konstantyna Brzęczyszczykiewicz', deleted: false },
    { id: 7103, name: 'Alexandra Fernández de la Cruz', deleted: false },
  ],
  providerId: FORM_USER_ID,
  providerName: 'Aleksandra Kowalska-Nowak',
  visibility: 'PROVIDER_SUBJECT',
  status: 'DRAFT',
  content: '## Platform launch\n\n**What went well**\n\n- Clear ownership across teams\n- Calm decisions during the incident\n\nNext, document the rollout checklist and share it with [the platform group](https://example.invalid/platform).',
  requesterMessage: null,
  expiresOn: null,
  lastModified: Date.parse('2026-10-02T14:25:00Z'),
  canShare: true,
  sharedBy: null,
} satisfies Schema['FeedbackResponse'];

export const sentFeedback = {
  id: SENT_FEEDBACK_ID,
  requesterId: 7103,
  requesterName: 'Alexandra Fernández de la Cruz',
  subjectId: 7102,
  subjectName: 'Konstantyna Brzęczyszczykiewicz',
  subjects: [
    { id: 7102, name: 'Konstantyna Brzęczyszczykiewicz', deleted: false },
  ],
  providerId: FORM_USER_ID,
  providerName: 'Aleksandra Kowalska-Nowak',
  visibility: 'PROVIDER_REQUESTER_SUBJECT',
  status: 'SENT',
  content: '## A strong launch\n\nYou kept a complex rollout focused on customer impact.\n\n- Risks were raised early\n- Decisions were documented clearly\n- The handover gave support teams confidence\n\n**Thank you for making collaboration feel effortless.**',
  requesterMessage: 'Please focus on collaboration during the international platform launch.',
  expiresOn: null,
  lastModified: Date.parse('2026-10-03T10:45:00Z'),
  canShare: true,
  sharedBy: null,
} satisfies Schema['FeedbackResponse'];

export const formTeam = {
  id: FORM_TEAM_ID,
  name: 'Customer Platform & Reliability',
  managerId: 7199,
  managerName: 'Christopher Montgomery-Wellington',
  managerDeleted: false,
  memberIds: [RELATIONSHIP_USER_ID, 7102],
  canManageKpis: false,
} satisfies Schema['TeamResponse'];

export const formManagedTeam = {
  id: 602,
  name: 'International Experience',
  managerId: FORM_USER_ID,
  managerName: 'Aleksandra Kowalska-Nowak',
  managerDeleted: false,
  memberIds: [RELATIONSHIP_USER_ID],
} satisfies Schema['TeamListItem'];

export const relationshipRows = [
  {
    userId: RELATIONSHIP_USER_ID,
    name: 'Maximilian Alexander von Hohenberg',
    email: 'maximilian@example.invalid',
    teamId: 602,
    teamName: 'International Experience',
    lastOneOnOneDate: '2026-09-28',
    lastOneOnOneOpenItems: 2,
    lastFeedbackAt: Date.parse('2026-09-25T13:30:00Z'),
    activeGoalCount: 3,
    lastReviewId: 401,
    lastReviewPeriodStartMonth: '2026-03',
    lastReviewPeriodEndMonth: '2026-08',
    lastReviewStatus: 'PUBLISHED',
    careerPath,
    careerSpecialization: specialization,
    seniorityLevel: seniority,
    nextVacationStart: '2026-10-19',
    daysOffRemaining: 8.5,
    lastLoginAt: Date.parse('2026-10-02T08:30:00Z'),
  },
] satisfies Schema['TeamMemberListItem'][];

export type FormsFixture = { matched: true; body: unknown } | { matched: false };

function page<T>(items: T[], pageSize = 100) {
  return { items, page: 1, pageSize, total: items.length };
}

/** Exact GET fixtures used only by the `forms` visual scenario. */
export function resolveFormsGet(url: URL): FormsFixture {
  const params = url.searchParams;
  if (url.pathname === '/api/v1/users' && params.get('page') === '1' && params.get('pageSize') === '100'
    && params.get('sort') === 'id') {
    const teamId = params.get('teamId');
    if (teamId === String(FORM_TEAM_ID) && params.size === 4) {
      return { matched: true, body: page(formUsers.filter((user) => formTeam.memberIds.includes(user.id))) };
    }
    if (teamId == null && params.size === 3) return { matched: true, body: page(formUsers) };
  }
  if (url.pathname === '/api/v1/templates' && params.get('page') === '1' && params.get('pageSize') === '100'
    && params.get('sort') === 'name' && params.size === 3) return { matched: true, body: templates };
  if (url.pathname === `/api/v1/feedbacks/${DRAFT_FEEDBACK_ID}` && params.size === 0) {
    return { matched: true, body: draftFeedback };
  }
  if (url.pathname === `/api/v1/feedbacks/${SENT_FEEDBACK_ID}` && params.size === 0) {
    return { matched: true, body: sentFeedback };
  }
  if ((url.pathname === `/api/v1/feedbacks/${DRAFT_FEEDBACK_ID}/events`
      || url.pathname === `/api/v1/feedbacks/${SENT_FEEDBACK_ID}/events`) && params.size === 0) {
    return { matched: true, body: { items: [] } satisfies Schema['FeedbackEventList'] };
  }
  if (url.pathname === `/api/v1/teams/${FORM_TEAM_ID}` && params.size === 0) {
    return { matched: true, body: formTeam };
  }
  if (url.pathname === '/api/v1/teams/members' && params.get('page') === '1'
    && params.get('pageSize') === '100' && params.size === 3) {
    const view = params.get('view');
    if (view === 'managers') return { matched: true, body: page([], 100) };
    if (view === 'managed') return { matched: true, body: page(relationshipRows, 100) };
  }
  if (url.pathname === '/api/v1/succession-plans' && params.get('view') === 'own'
    && params.get('status') === 'OPEN' && params.get('page') === '1' && params.get('pageSize') === '100'
    && params.size === 4) return { matched: true, body: page([], 100) };
  return { matched: false };
}
