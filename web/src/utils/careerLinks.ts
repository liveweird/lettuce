// Builder for the career-progression URL (the daysOffLinks pattern) — never hand-assemble it.
import { drillDownOptsSearch, type DrillDownOpts } from "./feedbackLinks";

/**
 * The per-user career-progression drill-down (`/users/:id/career`, v2.15.0) — the
 * userDaysOffLink shape minus the audit flavor (the read is open to everyone, so there is no
 * separate auditor view). `manages` (via `opts`) is what reveals the chain-manager editor.
 */
export function userCareerLink(
  userId: number,
  name: string,
  from: string,
  teamId?: number,
  opts?: DrillDownOpts,
): string {
  let url = `/users/${userId}/career?name=${encodeURIComponent(name)}&from=${from}`;
  if (teamId != null) url += `&teamId=${teamId}`;
  return url + drillDownOptsSearch(opts);
}
