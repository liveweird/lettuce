// Builders for the days-off URLs (the goalLinks pattern) — never hand-assemble them.
import { drillDownOptsSearch, type DrillDownOpts } from "./feedbackLinks";

export type DaysOffTab = "calendar" | "requests" | "team";

/** The Days off page, on a specific tab. */
export function daysOffListLink(tab: DaysOffTab): string {
  return `/days-off?tab=${tab}`;
}

/** The create-request screen, optionally with a return target. */
export function daysOffCreateLink(back?: string): string {
  return back ? `/days-off/new?back=${encodeURIComponent(back)}` : "/days-off/new";
}

/**
 * The per-user days-off drill-down (`/users/:id/days-off`) — v1 serves only the HR-audit entry
 * point (the userGoalsLink shape, minus the origins the page doesn't support yet).
 */
export function userDaysOffLink(
  userId: number,
  name: string,
  from: string,
  audit?: boolean,
  opts?: DrillDownOpts,
): string {
  let url = `/users/${userId}/days-off?name=${encodeURIComponent(name)}&from=${from}`;
  if (audit) url += `&mode=audit`;
  return url + drillDownOptsSearch(opts);
}
