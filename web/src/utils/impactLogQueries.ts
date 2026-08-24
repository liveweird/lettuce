import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalidates everything an impact log mutation can affect, in one place (the goalQueries
 * pattern): the journal lists, the single-entry document + its history, and the bell (every
 * mutation notifies the owner's direct managers). Awaits only the list + document (what the
 * current screen re-renders from); the rest refetch in the background.
 */
export async function invalidateImpactLog(queryClient: QueryClient, id?: number): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ["impactLog"] });
  if (id != null) await queryClient.invalidateQueries({ queryKey: ["impactEntry", id] });
  if (id != null) queryClient.invalidateQueries({ queryKey: ["impactEntryEvents", id] });
  queryClient.invalidateQueries({ queryKey: ["notifications"] });
}
