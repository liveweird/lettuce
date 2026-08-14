import type { QueryClient } from "@tanstack/react-query";

/**
 * The single invalidation seam for pulse mutations (the goalQueries convention): cycle
 * lifecycle changes move surveys/results/participation wholesale, mint notifications, and
 * flip the dashboard tile, so everything pulse-adjacent refreshes together.
 */
export async function invalidatePulse(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ["pulseCycles"] });
  queryClient.invalidateQueries({ queryKey: ["pulseSurvey"] });
  queryClient.invalidateQueries({ queryKey: ["pulseResults"] });
  queryClient.invalidateQueries({ queryKey: ["pulseTrend"] });
  queryClient.invalidateQueries({ queryKey: ["pulseTrendComparison"] });
  queryClient.invalidateQueries({ queryKey: ["pulseComments"] });
  queryClient.invalidateQueries({ queryKey: ["pulseParticipation"] });
  queryClient.invalidateQueries({ queryKey: ["pulseSettings"] });
  queryClient.invalidateQueries({ queryKey: ["notifications"] });
  queryClient.invalidateQueries({ queryKey: ["dashboardSummary"] });
}
