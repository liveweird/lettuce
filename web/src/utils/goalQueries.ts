import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalidates everything a goal mutation can affect, in one place (the block used to be
 * hand-written per page, with drift): the goal lists, the single-goal document + its history,
 * the bell, and the dashboard card grids whose "Active goals" stat counts ACTIVE goals
 * (ManagersTable's ["managers"], TeamMembersTable's ["teamMembers", …] prefix).
 * Awaits only the list + document (what the current screen re-renders from); the rest refetch
 * in the background.
 */
export async function invalidateGoal(queryClient: QueryClient, id?: number): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ["goals"] });
  if (id != null) await queryClient.invalidateQueries({ queryKey: ["goal", id] });
  if (id != null) queryClient.invalidateQueries({ queryKey: ["goalEvents", id] });
  queryClient.invalidateQueries({ queryKey: ["notifications"] });
  queryClient.invalidateQueries({ queryKey: ["managers"] });
  queryClient.invalidateQueries({ queryKey: ["teamMembers"] });
}
