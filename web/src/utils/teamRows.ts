// The /teams/members endpoints return one row per (user, team) membership, so a person tied
// to two of the caller's teams arrives twice. The person-card views collapse those rows to
// one card per user, aggregating the team names for the badges.

export type TeamRow = {
  userId: number;
  name: string;
  email: string;
  teamName: string;
  // Dashboard stats — present only on view=managers rows, identical on every row of a user.
  lastOneOnOneDate?: string | null;
  lastOneOnOneOpenItems?: number | null;
  lastFeedbackAt?: number | null;
};

export type PersonCard = {
  userId: number;
  name: string;
  email: string;
  teamNames: string[];
  lastOneOnOneDate: string | null;
  lastOneOnOneOpenItems: number | null;
  lastFeedbackAt: number | null;
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
        // Normalize absent → null so the stat-less grids (peers/subordinates) stay uniform.
        lastOneOnOneDate: r.lastOneOnOneDate ?? null,
        lastOneOnOneOpenItems: r.lastOneOnOneOpenItems ?? null,
        lastFeedbackAt: r.lastFeedbackAt ?? null,
      });
    }
  }
  return [...byId.values()];
}
