import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalidates everything a user-account mutation can affect, in one place (the block used to
 * be hand-written per page, with drift): the users lists (the picker and feature-flag reads
 * share the prefix), the single-user document + the relationship-aware details view, the
 * header account menu (["currentUser", …] — a self-edit must refresh the displayed
 * name/email), and the dashboard card grids that render the person's name and email
 * (ManagersTable's ["managers"], TeamMembersTable's ["teamMembers", …] prefix).
 * Awaits only the list + document (what the current screen re-renders from); the rest refetch
 * in the background.
 */
export async function invalidateUser(queryClient: QueryClient, id?: number): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ["users"] });
  if (id != null) await queryClient.invalidateQueries({ queryKey: ["user", id] });
  if (id != null) queryClient.invalidateQueries({ queryKey: ["userDetails", id] });
  queryClient.invalidateQueries({ queryKey: ["currentUser"] });
  queryClient.invalidateQueries({ queryKey: ["managers"] });
  queryClient.invalidateQueries({ queryKey: ["teamMembers"] });
}
