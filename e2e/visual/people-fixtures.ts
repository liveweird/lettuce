import type { components } from '../../web/src/api/schema';

type Schema = components['schemas'];
const timestamp = Date.parse('2026-10-01T10:00:00Z');

export const people: Schema['UserResponse'][] = [
  { id: 7201, name: 'Christopher Montgomery-Wellington', email: 'christopher.montgomery-wellington@example.invalid', roles: [], uniqueId: 'ENG-PLATFORM-001', deactivated: false },
  { id: 7202, name: 'Joanna Wiśniewska', email: 'joanna.wisniewska@example.invalid', roles: ['HR'], uniqueId: null, deactivated: false },
  { id: 7203, name: 'Maximilian Alexander von Hohenberg', email: 'maximilian.alexander.von.hohenberg@example.invalid', roles: ['ADMIN'], uniqueId: 'OPS-0042', deactivated: true },
].map((person) => ({
  ...person, roles: person.roles as Schema['UserResponse']['roles'],
  careerPath: null, careerSpecialization: null, seniorityLevel: null,
  disabledFeatures: [], emailNotificationsEnabled: false, language: 'en', lastLoginAt: null,
}));

export const teams = [
  { id: 8101, name: 'International platform reliability and customer experience', managerId: 7201, managerName: people[0].name, managerDeleted: false, memberIds: [7001, 7202] },
  { id: 8102, name: 'Research and inclusive product design', managerId: 7202, managerName: people[1].name, managerDeleted: false, memberIds: [7001, 7201] },
  { id: 8103, name: 'Operations', managerId: 7203, managerName: people[2].name, managerDeleted: false, memberIds: [7202] },
] satisfies Schema['TeamListItem'][];

export function cardPeople(managed: boolean): Schema['TeamMemberListItem'][] {
  return people.slice(0, managed ? 3 : 2).map((person, index) => ({
    userId: person.id, name: person.name, email: person.email,
    teamId: teams[index].id, teamName: teams[index].name,
    careerPath: index === 0 ? { id: 101, values: { en: 'Engineering', pl: 'Inżynieria' } } : null,
    careerSpecialization: index === 0 ? { id: 201, values: { en: 'Distributed systems and platform reliability', pl: 'Systemy rozproszone' } } : null,
    seniorityLevel: managed && index === 0 ? { id: 301, values: { en: 'Senior', pl: 'Senior' } } : null,
    lastFeedbackGivenAt: index === 0 ? timestamp : null,
    lastFeedbackReceivedAt: index === 1 ? timestamp - 86400000 : null,
    lastOneOnOneDate: index === 0 ? '2026-09-28' : null,
    lastOneOnOneOpenItems: index === 0 ? 3 : null,
    activeGoalCount: index === 0 ? 2 : 0,
    lastReviewId: managed && index === 0 ? 9101 : null,
    lastReviewPeriodStartMonth: managed && index === 0 ? '2026-07' : null,
    lastReviewPeriodEndMonth: managed && index === 0 ? '2026-12' : null,
    lastReviewStatus: managed && index === 0 ? 'CALIBRATION' : null,
    nextVacationStart: managed && index === 1 ? '2026-10-12' : null,
    daysOffRemaining: managed ? 12.5 - index : null,
    lastLoginAt: managed && index === 0 ? timestamp : null,
  }));
}

export function dashboardSummary(managed: boolean): Schema['DashboardSummary'] {
  return {
    pendingFeedbackRequests: 2, activeGoals: 4, feedbackReceived30d: 7, feedbackReceivedPrev30d: 5,
    directReports: managed ? 3 : 0, currentPeriodId: managed ? 9100 : null,
    currentPeriodReviewsDone: managed ? 1 : null, pulseOpenCloseDate: '2026-10-15', pulseSubmitted: false,
  };
}
