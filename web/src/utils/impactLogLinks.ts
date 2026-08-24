import { detailSearch, drillDownOptsSearch, type DrillDownOpts } from "./linkSearch";

// Builders for every impact-log URL, so the query-string shape lives in one place instead of
// being hand-assembled at call sites — the goalLinks pattern. Identity is never carried in the
// URL (the v2.35.0 rule): entries resolve their owner from the record.

/** The entry create screen, optionally with a return target. */
export function impactEntryCreateLink(back?: string): string {
  return `/impact-log/new${back ? `?back=${encodeURIComponent(back)}` : ""}`;
}

/** The read-only entry document (Content/History tabs). */
export function impactEntryViewLink(id: number, back?: string): string {
  return `/impact-log/${id}/view${detailSearch(undefined, back)}`;
}

/** The entry editor (owner-only server-side). */
export function impactEntryEditLink(id: number, back?: string): string {
  return `/impact-log/${id}/edit${detailSearch(undefined, back)}`;
}

/**
 * The per-person impact log drill-down (`/users/:id/impact-log`) — the HR auditor's journal
 * view (the userGoalsLink shape; today only the audit flavor links here).
 */
export function userImpactLogLink(
  userId: number,
  name: string,
  from: string,
  audit?: boolean,
  opts?: DrillDownOpts,
): string {
  let url = `/users/${userId}/impact-log?name=${encodeURIComponent(name)}&from=${from}`;
  if (audit) url += `&mode=audit`;
  return url + drillDownOptsSearch(opts);
}
