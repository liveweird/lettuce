// The /teams/members endpoints return one row per (user, team) membership, so a person tied
// to two of the caller's teams arrives twice. The person-card views collapse those rows to
// one card per user, aggregating the team names for the badges.

type CareerEntry = { id: number; valueEn: string; valuePl: string };

export type TeamRef = { id: number; name: string };

export type TeamRow = {
  userId: number;
  name: string;
  email: string;
  teamId: number;
  teamName: string;
  // Dashboard stats, identical on every row of a user: the 1:1/lastFeedbackAt trio on
  // view=managers/managed rows, the given/received pair on view=member rows.
  lastOneOnOneDate?: string | null;
  lastOneOnOneOpenItems?: number | null;
  lastFeedbackAt?: number | null;
  lastFeedbackGivenAt?: number | null;
  lastFeedbackReceivedAt?: number | null;
  activeGoalCount?: number | null;
  // The caller's latest authored performance review (v1.34.0), view=managed rows only.
  lastReviewId?: number | null;
  lastReviewPeriodStartMonth?: string | null;
  lastReviewPeriodEndMonth?: string | null;
  lastReviewStatus?: "DRAFT" | "CALIBRATION" | "PUBLISHED" | null;
  // The career profile (v1.32.1), populated on every view's rows; null = unset.
  careerPath?: CareerEntry | null;
  careerSpecialization?: CareerEntry | null;
  seniorityLevel?: CareerEntry | null;
  // Days-off card stats (v1.44.0): next accepted vacation on managed + member rows;
  // remaining budget on managed rows only.
  nextVacationStart?: string | null;
  daysOffRemaining?: number | null;
};

export type PersonCard = {
  userId: number;
  name: string;
  email: string;
  /** The person's teams with ids — the card badges link to team details (v2.5.4). */
  teams: TeamRef[];
  /** Names only, derived from [teams] — kept for the name-keyed consumers (reviews dashboard). */
  teamNames: string[];
  lastOneOnOneDate: string | null;
  lastOneOnOneOpenItems: number | null;
  lastFeedbackAt: number | null;
  lastFeedbackGivenAt: number | null;
  lastFeedbackReceivedAt: number | null;
  activeGoalCount: number | null;
  lastReviewId: number | null;
  lastReviewPeriodStartMonth: string | null;
  lastReviewPeriodEndMonth: string | null;
  lastReviewStatus: "DRAFT" | "CALIBRATION" | "PUBLISHED" | null;
  careerPath: CareerEntry | null;
  careerSpecialization: CareerEntry | null;
  seniorityLevel: CareerEntry | null;
  nextVacationStart: string | null;
  daysOffRemaining: number | null;
};

export function groupTeamRows(rows: TeamRow[]): PersonCard[] {
  const byId = new Map<number, PersonCard>();
  for (const r of rows) {
    const existing = byId.get(r.userId);
    if (existing) {
      if (!existing.teams.some((team) => team.id === r.teamId)) {
        existing.teams.push({ id: r.teamId, name: r.teamName });
        existing.teamNames.push(r.teamName);
      }
    } else {
      byId.set(r.userId, {
        userId: r.userId,
        name: r.name,
        email: r.email,
        teams: [{ id: r.teamId, name: r.teamName }],
        teamNames: [r.teamName],
        // Normalize absent → null so every grid can render its "never" empty states
        // off the fields the other views don't populate.
        lastOneOnOneDate: r.lastOneOnOneDate ?? null,
        lastOneOnOneOpenItems: r.lastOneOnOneOpenItems ?? null,
        lastFeedbackAt: r.lastFeedbackAt ?? null,
        lastFeedbackGivenAt: r.lastFeedbackGivenAt ?? null,
        lastFeedbackReceivedAt: r.lastFeedbackReceivedAt ?? null,
        activeGoalCount: r.activeGoalCount ?? null,
        lastReviewId: r.lastReviewId ?? null,
        lastReviewPeriodStartMonth: r.lastReviewPeriodStartMonth ?? null,
        lastReviewPeriodEndMonth: r.lastReviewPeriodEndMonth ?? null,
        lastReviewStatus: r.lastReviewStatus ?? null,
        careerPath: r.careerPath ?? null,
        careerSpecialization: r.careerSpecialization ?? null,
        seniorityLevel: r.seniorityLevel ?? null,
        nextVacationStart: r.nextVacationStart ?? null,
        daysOffRemaining: r.daysOffRemaining ?? null,
      });
    }
  }
  return [...byId.values()];
}
