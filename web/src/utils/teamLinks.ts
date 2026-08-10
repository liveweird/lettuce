// Builder for the team-details view URL (`/teams/:id/members`), so the path shape lives in
// one place — the userLinks/goalLinks pattern. Team names across the app link here (v2.5.4);
// the org chart's `?from=org` back-origin variant stays local to OrgChart.
export function teamDetailsLink(teamId: number): string {
  return `/teams/${teamId}/members`;
}
