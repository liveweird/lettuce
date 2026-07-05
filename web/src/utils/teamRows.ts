// The /teams/members endpoints return one row per (user, team) membership, so a person tied
// to two of the caller's teams arrives twice. The person-card views collapse those rows to
// one card per user, aggregating the team names for the badges.

export type TeamRow = { userId: number; name: string; email: string; teamName: string };

export type PersonCard = {
  userId: number;
  name: string;
  email: string;
  teamNames: string[];
};

export function groupTeamRows(rows: TeamRow[]): PersonCard[] {
  const byId = new Map<number, PersonCard>();
  for (const r of rows) {
    const existing = byId.get(r.userId);
    if (existing) {
      if (!existing.teamNames.includes(r.teamName)) existing.teamNames.push(r.teamName);
    } else {
      byId.set(r.userId, { userId: r.userId, name: r.name, email: r.email, teamNames: [r.teamName] });
    }
  }
  return [...byId.values()];
}
