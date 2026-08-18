import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalidates everything a feedback mutation can affect, in one place (the block used to be
 * hand-written per page, with drift): the feedback lists (Kudos included via the prefix), the
 * single-feedback document + its history, the duplicate-check probes (both key shapes share
 * the prefix — a deleted draft must clear the "already in progress" warning), the bell, and
 * the dashboard card grids whose "Last feedback" stats come from delivered feedback
 * (ManagersTable's ["managers"], TeamMembersTable's ["teamMembers", …] prefix).
 * Awaits only the list + document (what the current screen re-renders from); the rest refetch
 * in the background.
 */
export async function invalidateFeedback(queryClient: QueryClient, id?: number): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ["feedbacks"] });
  if (id != null) await queryClient.invalidateQueries({ queryKey: ["feedback", id] });
  if (id != null) queryClient.invalidateQueries({ queryKey: ["feedbackEvents", id] });
  queryClient.invalidateQueries({ queryKey: ["feedbackDuplicate"] });
  queryClient.invalidateQueries({ queryKey: ["notifications"] });
  queryClient.invalidateQueries({ queryKey: ["managers"] });
  queryClient.invalidateQueries({ queryKey: ["teamMembers"] });
}
