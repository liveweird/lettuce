// The /teams/members endpoints return one row per (user, team) membership, so a person tied
// to two of the caller's teams arrives twice. The person-card views collapse those rows to
// one card per user, aggregating the team names for the badges.

type CareerEntry = { id: number; value: string };

export type TeamRow = {
  userId: number;
  name: string;
  email: string;
  teamName: string;
  // Dashboard stats, identical on every row of a user: the 1:1/lastFeedbackAt trio on
  // view=managers/managed rows, the given/received pair on view=member rows.
  lastOneOnOneDate?: string | null;
  lastOneOnOneOpenItems?: number | null;
  lastFeedbackAt?: number | null;
  lastFeedbackGivenAt?: number | null;
  lastFeedbackReceivedAt?: number | null;
  activeGoalCount?: number | null;
  // The career profile (v1.32.1), populated on every view's rows; null = unset.
  careerPath?: CareerEntry | null;
  careerSpecialization?: CareerEntry | null;
  seniorityLevel?: CareerEntry | null;
};

export type PersonCard = {
  userId: number;
  name: string;
  email: string;
  teamNames: string[];
  lastOneOnOneDate: string | null;
  lastOneOnOneOpenItems: number | null;
  lastFeedbackAt: number | null;
  lastFeedbackGivenAt: number | null;
  lastFeedbackReceivedAt: number | null;
  activeGoalCount: number | null;
  careerPath: CareerEntry | null;
  careerSpecialization: CareerEntry | null;
  seniorityLevel: CareerEntry | null;
};

export function groupTeamRows(rows: TeamRow[]): PersonCard[] {
  const byId = new Map<number, PersonCard>();
  for (const r of rows) {
    const existing = byId.get(r.userId);
    if (existing) {
      if (!existing.teamNames.includes(r.teamName)) existing.teamNames.push(r.teamName);
    } else {
      byId.set(r.userId, {
        userId: r.userId,
        name: r.name,
        email: r.email,
        teamNames: [r.teamName],
        // Normalize absent → null so every grid can render its "never" empty states
        // off the fields the other views don't populate.
        lastOneOnOneDate: r.lastOneOnOneDate ?? null,
        lastOneOnOneOpenItems: r.lastOneOnOneOpenItems ?? null,
        lastFeedbackAt: r.lastFeedbackAt ?? null,
        lastFeedbackGivenAt: r.lastFeedbackGivenAt ?? null,
        lastFeedbackReceivedAt: r.lastFeedbackReceivedAt ?? null,
        activeGoalCount: r.activeGoalCount ?? null,
        careerPath: r.careerPath ?? null,
        careerSpecialization: r.careerSpecialization ?? null,
        seniorityLevel: r.seniorityLevel ?? null,
      });
    }
  }
  return [...byId.values()];
}
