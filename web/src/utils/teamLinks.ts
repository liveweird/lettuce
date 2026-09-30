// Builder for the team-details view URL (`/teams/:id/details` — renamed from the historical
// `/members` in v2.5.7, which now redirects), so the path shape lives in one place — the
// userLinks/goalLinks pattern. Team names across the app link here (v2.5.4). `from` marks the
// origin the page's back link returns to (`org` = the org chart, `myTeams` = Dashboard → My
// teams; anything else is the teams list); `back` (v4.6.0) is the exact in-app URL the link was
// clicked on and wins the destination (sanitized by `safeBackParam` on read) — the two compose,
// `from` keeping the label.
export function teamDetailsLink(
  teamId: number,
  opts?: { from?: "org" | "myTeams"; back?: string },
): string {
  const query = new URLSearchParams();
  if (opts?.from) query.set("from", opts.from);
  if (opts?.back) query.set("back", opts.back);
  const queryString = query.toString();
  return `/teams/${teamId}/details${queryString ? `?${queryString}` : ""}`;
}
