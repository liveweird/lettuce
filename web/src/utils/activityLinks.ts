import { getUserId } from "../api/session";
import { drillDownOptsSearch, type DrillDownOpts } from "./linkSearch";

/**
 * The per-person activity-log drill-down (`/users/:id/activity`, v4.9.0) — the manager's view of
 * a report's log and, with `audit`, the HR auditor's (`?mode=audit`). One's own log is the nav
 * page, so the viewer's own id routes to `/activity` instead (the card of the signed-in person).
 */
export function userActivityLink(
  userId: number,
  name: string,
  from: string,
  teamId?: number,
  audit?: boolean,
  opts?: DrillDownOpts,
): string {
  if (userId === getUserId()) return "/activity";
  let url = `/users/${userId}/activity?name=${encodeURIComponent(name)}&from=${from}`;
  if (teamId != null) url += `&teamId=${teamId}`;
  if (audit) url += `&mode=audit`;
  return url + drillDownOptsSearch(opts);
}
