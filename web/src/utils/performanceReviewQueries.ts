import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalidates everything a performance-review mutation can affect, in one place (the
 * invalidateGoal idiom): the review lists, the single-review document + its history, and the
 * bell (publish/unpublish notify the subordinate). No dashboard-card coupling — the person
 * cards carry no review stats. Awaits only the list + document (what the current screen
 * re-renders from); the rest refetch in the background.
 */
export async function invalidatePerformanceReview(
  queryClient: QueryClient,
  id?: number,
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ["performanceReviews"] });
  if (id != null) await queryClient.invalidateQueries({ queryKey: ["performanceReview", id] });
  if (id != null) queryClient.invalidateQueries({ queryKey: ["performanceReviewEvents", id] });
  queryClient.invalidateQueries({ queryKey: ["notifications"] });
}
