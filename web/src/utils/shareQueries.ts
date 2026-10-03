import type { QueryClient } from "@tanstack/react-query";
import type { ShareableResourceType } from "../api/shares";

// The react-query key of each shareable kind's single-document query (the view pages own them).
const DOCUMENT_QUERY_KEY: Record<ShareableResourceType, string> = {
  FEEDBACK: "feedback",
  ONE_ON_ONE: "oneOnOne",
  GOAL: "goal",
  TEAM_KPI: "teamKpi",
  PERFORMANCE_REVIEW: "performanceReview",
  IMPACT_LOG_ENTRY: "impactEntry",
  SUCCESSION_PLAN: "successionPlan",
  // A calendar has no single-document query (its resource is a person; the Calendar tab owns the data).
  DAYS_OFF_CALENDAR: "daysOffCalendar",
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
    queryClient.invalidateQueries({ queryKey: [DOCUMENT_QUERY_KEY[resourceType], resourceId] });
  }
  queryClient.invalidateQueries({ queryKey: ["notifications"] });
}
