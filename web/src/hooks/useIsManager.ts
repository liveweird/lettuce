import { useQuery } from "@tanstack/react-query";
import { getUserId } from "../api/session";
import { listTeams } from "../api/teams";

/**
 * Whether the current user manages at least one team — the gate for the manager-only tabs
 * (Feedback's team view, 1:1s, Goals, Team KPIs) and the tour's manager-only steps. One shared
 * cache key, so every consumer (the tour included) dedupes onto a single cheap fetch
 * (pageSize 1 — only `total` matters).
 */
export function useIsManager(): boolean {
  const userId = getUserId();
  const { data: managedTeams } = useQuery({
    queryKey: ["managedTeams", userId],
    queryFn: () => listTeams({ page: 1, pageSize: 1, managerId: userId! }),
    enabled: userId !== null,
  });
  return (managedTeams?.total ?? 0) > 0;
}
