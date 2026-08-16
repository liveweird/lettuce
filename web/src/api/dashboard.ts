// Dashboard summary API — the hero tiles' caller-scoped counts.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { ApiError, authedFetch, safeJson } from "./http";
import type { paths } from "./schema";

export type DashboardSummary =
  paths["/api/v1/dashboard/summary"]["get"]["responses"]["200"]["content"]["application/json"];

/** The caller's at-a-glance numbers for the Dashboard hero tiles — strictly caller-scoped. */
export async function getDashboardSummary(): Promise<DashboardSummary> {
  const res = await authedFetch("/api/v1/dashboard/summary");
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as DashboardSummary;
}
