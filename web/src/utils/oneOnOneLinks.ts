import { detailSearch, drillDownOptsSearch, type DrillDownOpts } from "./linkSearch";

// Builders for every 1:1-flow URL, so the query-string shape (and encodeURIComponent) lives in
// one place instead of being hand-assembled at every call site — the goalLinks pattern.
// Optional parts are appended only when given.
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

/** The read-only 1:1 document. `from` names the originating tab (`own`/`managed`/`with`/`team`). */
export function oneOnOneViewLink(id: number, from?: string, back?: string): string {
  return `/one-on-ones/${id}/view${detailSearch(from, back)}`;
}

/** The 1:1 editor (only the pair's latest meeting — older ones redirect to the view). */
export function oneOnOneEditLink(id: number, from?: string, back?: string): string {
  return `/one-on-ones/${id}/edit${detailSearch(from, back)}`;
}

/**
 * The per-user 1:1 drill-down (`/users/:id/one-on-ones`), as linked from the dashboard cards.
 * `teamId` only matters with `from="team"` (the team-scoped subordinates view) — it lets the
 * drill-down's "Back to …" return to that team's view (the userGoalsLink shape).
 */
export function userOneOnOnesLink(
  userId: number,
  name: string,
  from: string,
  teamId?: number,
  audit?: boolean,
  opts?: DrillDownOpts,
): string {
  let url = `/users/${userId}/one-on-ones?name=${encodeURIComponent(name)}&from=${from}`;
  if (teamId != null) url += `&teamId=${teamId}`;
  if (audit) url += `&mode=audit`;
  return url + drillDownOptsSearch(opts);
}
