import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalidates everything a 1:1 mutation can affect (the goalQueries pattern): the meeting
 * lists, the single document + its history, the bell, and the dashboard card grids whose
 * "Last 1:1" stat reads the latest meeting (ManagersTable's ["managers"], TeamMembersTable's
 * ["teamMembers", …] prefix). Awaits only the list + document; the rest refetch in the
 * background.
 */
export async function invalidateOneOnOne(queryClient: QueryClient, id?: number): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ["oneOnOnes"] });
  if (id != null) await queryClient.invalidateQueries({ queryKey: ["oneOnOne", id] });
  if (id != null) queryClient.invalidateQueries({ queryKey: ["oneOnOneEvents", id] });
  queryClient.invalidateQueries({ queryKey: ["notifications"] });
  queryClient.invalidateQueries({ queryKey: ["managers"] });
  queryClient.invalidateQueries({ queryKey: ["teamMembers"] });
}
