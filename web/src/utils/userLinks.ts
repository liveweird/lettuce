// Builder for the read-only user-details view URL (`/users/:userId/details`), so the
// query-string shape (and encodeURIComponent) lives in one place — the feedbackLinks pattern.
// `name` feeds the heading there without a getUser call (which is self-or-admin only); `from`
// names the originating screen for the "Back to …" link, with `members` parameterized by the
// team whose roster the link came from.
export function userDetailsLink(
  userId: number,
  name?: string | null,
  from?: "users" | "members" | "teams" | "org",
  teamId?: number,
): string {
  const query = new URLSearchParams();
  if (name) query.set("name", name);
  if (from) query.set("from", from);
  if (teamId != null) query.set("teamId", String(teamId));
  const queryString = query.toString();
  return `/users/${userId}/details${queryString ? `?${queryString}` : ""}`;
}
