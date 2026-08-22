import { detailSearch, drillDownOptsSearch, type DrillDownOpts } from "./linkSearch";

// Builders for every goal-flow URL, so the query-string shape (and encodeURIComponent) lives
// in one place instead of being hand-assembled at call sites — the feedbackLinks pattern.
// Optional parts are appended only when given.

/**
 * The goal create screen, optionally prefilled with the subordinate and a return target.
 * Without a subordinate the create screen shows its direct-report picker (the
 * teamKpiCreateLink shape).
 */
export function goalCreateLink(subordinateId?: number, back?: string): string {
  const parts: string[] = [];
  if (subordinateId != null) parts.push(`subordinateId=${subordinateId}`);
  if (back) parts.push(`back=${encodeURIComponent(back)}`);
  return `/goals/new${parts.length ? `?${parts.join("&")}` : ""}`;
}

/** The read-only goal document. */
export function goalViewLink(id: number, from?: string, back?: string): string {
  return `/goals/${id}/view${detailSearch(from, back)}`;
}

/** The status-branching goal editor. */
export function goalEditLink(id: number, from?: string, back?: string): string {
  return `/goals/${id}/edit${detailSearch(from, back)}`;
}

/**
 * The per-user goals drill-down (`/users/:id/goals`), as linked from the dashboard cards.
 * `from` is a useDashboardDrillDown origin (`managers`/`subordinates`/`team`/`details`);
 * `teamId` only matters with `from="team"` (the team-scoped subordinates view) — it lets the
 * drill-down's "Back to …" return to that team's view. `opts.back` overrides the drill-down's
 * return URL (the details-page round-trip) and `opts.manages` keeps the manager-only
 * affordances when the origin alone can't prove the relationship (`from=details`).
 */
export function userGoalsLink(
  userId: number,
  name: string,
  from: string,
  teamId?: number,
  audit?: boolean,
  opts?: DrillDownOpts,
): string {
  let url = `/users/${userId}/goals?name=${encodeURIComponent(name)}&from=${from}`;
  if (teamId != null) url += `&teamId=${teamId}`;
  if (audit) url += `&mode=audit`;
  return url + drillDownOptsSearch(opts);
}
