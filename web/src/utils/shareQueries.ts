import type { QueryClient } from "@tanstack/react-query";
import type { ShareableResourceType } from "../api/shares";

// The react-query key prefix of each shareable kind's document query (the view pages own them), built
// from the share's resource id.
const DOCUMENT_QUERY_KEY: Record<ShareableResourceType, (resourceId: number) => readonly unknown[]> = {
  FEEDBACK: (id) => ["feedback", id],
  ONE_ON_ONE: (id) => ["oneOnOne", id],
  GOAL: (id) => ["goal", id],
  TEAM_KPI: (id) => ["teamKpi", id],
  PERFORMANCE_REVIEW: (id) => ["performanceReview", id],
  IMPACT_LOG_ENTRY: (id) => ["impactEntry", id],
  SUCCESSION_PLAN: (id) => ["successionPlan", id],
  // A calendar has no single-document query (its resource is a person; the Calendar tab owns the data).
  DAYS_OFF_CALENDAR: (id) => ["daysOffCalendar", id],
  // The resource is a TEAM and its results cards are keyed ["pulseResults", cycleId, teamId, mode] — the
  // cycle comes before the team, so the whole prefix is invalidated (cheap: the results tab only).
  PULSE_TEAM_RESULTS: () => ["pulseResults"],
};

/** The "Current shares" list of ONE document — under the ["shares", …] prefix. */
export function documentSharesKey(resourceType: ShareableResourceType, resourceId: number) {
  return ["shares", "document", resourceType, resourceId] as const;
}

/**
 * Invalidates everything a share mutation can affect, in one place (the goalQueries pattern):
 * every shares list (the dialog's and the Shared screen's, via the prefix), the document the
 * dialog sits on (its `canShare`/`sharedBy` flags are server-computed) and the bell (the author's
 * withdrawal mints the sharer a copy). Awaits only the shares lists; the rest refetch in the
 * background.
 */
export async function invalidateShares(
  queryClient: QueryClient,
  resourceType?: ShareableResourceType,
  resourceId?: number,
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ["shares"] });
  if (resourceType != null && resourceId != null) {
    queryClient.invalidateQueries({ queryKey: DOCUMENT_QUERY_KEY[resourceType](resourceId) });
  }
  queryClient.invalidateQueries({ queryKey: ["notifications"] });
}
