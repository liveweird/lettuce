// Builder for the team-details view URL (`/teams/:id/members`), so the path shape lives in
// one place — the userLinks/goalLinks pattern. Team names across the app link here (v2.5.4);
// the back-origin variants (`?from=org` in OrgChart, `?from=myTeams` in MyTeamsTable) stay
// inline at their single call sites.
export function teamDetailsLink(teamId: number): string {
  return `/teams/${teamId}/members`;
}
