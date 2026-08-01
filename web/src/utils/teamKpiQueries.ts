import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalidates everything a team-KPI mutation can affect, in one place (the invalidateGoal
 * pattern): the KPI lists, the single-KPI document + its history (which also feeds the Graph
 * tab), and the bell. No dashboard card grid carries a KPI stat yet, so nothing else refetches.
 * Awaits only the list + document (what the current screen re-renders from); the rest refetch
 * in the background.
 */
export async function invalidateTeamKpi(queryClient: QueryClient, id?: number): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ["teamKpis"] });
  if (id != null) await queryClient.invalidateQueries({ queryKey: ["teamKpi", id] });
  if (id != null) queryClient.invalidateQueries({ queryKey: ["teamKpiEvents", id] });
  queryClient.invalidateQueries({ queryKey: ["notifications"] });
}
