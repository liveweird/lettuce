// Builder for the team-details view URL (`/teams/:id/details` — renamed from the historical
// `/members` in v2.5.7, which now redirects), so the path shape lives in one place — the
// userLinks/goalLinks pattern. Team names across the app link here (v2.5.4); the back-origin
// variants (`?from=org` in OrgChart, `?from=myTeams` in MyTeamsTable) stay inline at their
// single call sites.
export function teamDetailsLink(teamId: number): string {
  return `/teams/${teamId}/details`;
}
