import { detailSearch, drillDownOptsSearch, type DrillDownOpts } from "./linkSearch";

// Builders for every succession-plan URL, so the query-string shape lives in one place instead
// of being hand-assembled at call sites — the goalLinks pattern. Identity is never carried in
// the URL (the v2.35.0 rule): plans resolve their parties from the record.

/** The plan create screen, optionally with a return target. */
export function successionPlanCreateLink(back?: string): string {
  return `/succession/new${detailSearch(undefined, back)}`;
}

/** The read-only plan document (definition + the nomination bench). */
export function successionPlanViewLink(id: number, back?: string): string {
  return `/succession/${id}/view${detailSearch(undefined, back)}`;
}

/** The plan definition editor (owner-only server-side). */
export function successionPlanEditLink(id: number, back?: string): string {
  return `/succession/${id}/edit${detailSearch(undefined, back)}`;
}

/** The nomination create screen under a plan. */
export function successionNominationCreateLink(planId: number, back?: string): string {
  return `/succession/${planId}/nominations/new${detailSearch(undefined, back)}`;
}

/** The nomination editor (owner-only server-side). */
export function successionNominationEditLink(
  planId: number,
  nominationId: number,
  back?: string,
): string {
  return `/succession/${planId}/nominations/${nominationId}/edit${detailSearch(undefined, back)}`;
}

/**
 * The per-person succession drill-down (`/users/:id/succession`) — the HR auditor's view of
 * every plan the person is a party to (the userImpactLogLink shape; audit-only today).
 */
export function userSuccessionLink(
  userId: number,
  name: string,
  from: string,
  teamId?: number,
  audit?: boolean,
  opts?: DrillDownOpts,
): string {
  let url = `/users/${userId}/succession?name=${encodeURIComponent(name)}&from=${from}`;
  if (teamId != null) url += `&teamId=${teamId}`;
  if (audit) url += `&mode=audit`;
  return url + drillDownOptsSearch(opts);
}
