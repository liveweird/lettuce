// Builder for the 1:1 create-flow URL, so the query-string shape (and encodeURIComponent) lives in
// one place instead of being hand-assembled at every call site. `subordinateName` and `back` are
// each appended only when given, matching the per-person drill-down link that omits the name.
export function oneOnOneCreateLink(
  subordinateId: number,
  subordinateName?: string | null,
  back?: string,
): string {
  let url = `/one-on-ones/new?subordinateId=${subordinateId}`;
  if (subordinateName) url += `&subordinateName=${encodeURIComponent(subordinateName)}`;
  if (back) url += `&back=${encodeURIComponent(back)}`;
  return url;
}

/**
 * The per-user 1:1 drill-down (`/users/:id/one-on-ones`), as linked from the dashboard cards.
 * `teamId` only matters with `from="team"` (the team-scoped subordinates view) — it lets the
 * drill-down's "Back to …" return to that team's view (the userGoalsLink shape).
 */
export function userOneOnOnesLink(
  userId: number,
  name: string,
  from: "managers" | "subordinates" | "team" | "details",
  teamId?: number,
  audit?: boolean,
): string {
  let url = `/users/${userId}/one-on-ones?name=${encodeURIComponent(name)}&from=${from}`;
  if (teamId != null) url += `&teamId=${teamId}`;
  if (audit) url += `&mode=audit`;
  return url;
}
