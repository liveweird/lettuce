// Dashboard summary API — the hero tiles' caller-scoped counts.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { jsonRequest } from "./http";
import type { paths } from "./schema";

export type DashboardSummary =
  paths["/api/v1/dashboard/summary"]["get"]["responses"]["200"]["content"]["application/json"];

/** The caller's at-a-glance numbers for the Dashboard hero tiles — strictly caller-scoped. */
export async function getDashboardSummary(): Promise<DashboardSummary> {
  return jsonRequest<DashboardSummary>("/api/v1/dashboard/summary");
}
