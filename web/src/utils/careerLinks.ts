// Builder for the career-progression URL (the daysOffLinks pattern) — never hand-assemble it.
import { drillDownOptsSearch, type DrillDownOpts } from "./linkSearch";

/**
 * The per-user career-progression drill-down (`/users/:id/career`, v2.15.0) — the
 * userDaysOffLink shape minus the audit flavor (the read is self/chain/HR-only since v2.25.0,
 * but HR reads the same view everyone else does, so there is no separate auditor mode; the
 * card sites gate the link on `manages`/`canAudit()` instead). Since v2.34.0 the editor
 * renders off the timeline response's server-computed `canEdit` — `manages` (via `opts`)
 * is only a link-affordance hint here, no longer a rights signal.
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
