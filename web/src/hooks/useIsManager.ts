import { useQuery } from "@tanstack/react-query";
import { getUserId } from "../api/session";
import { listTeams } from "../api/teams";

/**
 * The underlying managed-teams probe, exposing whether it has RESOLVED yet — a caller that
 * picks a default off `isManager` (e.g. ReviewsDashboard's auditor-scope default, v4.3.0) must
 * wait for `isResolved` first: while the query is loading, `isManager` reads `false` like a
 * genuine non-manager, and choosing a role-dependent default off that transient value can fire
 * a wrong request (and, for an HR caller, a false `hr.list` audit event) that then flips once
 * the real answer arrives. `useIsManager()` below is the plain-boolean sibling most callers want.
 */
export function useIsManagerStatus(): { isManager: boolean; isResolved: boolean } {
  const userId = getUserId();
  const { data: managedTeams, isSuccess } = useQuery({
    queryKey: ["managedTeams", userId],
    queryFn: () => listTeams({ page: 1, pageSize: 1, managerId: userId! }),
    enabled: userId !== null,
  });
  return { isManager: (managedTeams?.total ?? 0) > 0, isResolved: isSuccess };
}

/**
 * Whether the current user manages at least one team — the gate for the manager-only tabs
 * (Feedback's team view, 1:1s, Goals, Team KPIs) and the tour's manager-only steps. One shared
 * cache key, so every consumer (the tour included) dedupes onto a single cheap fetch
 * (pageSize 1 — only `total` matters).
 */
export function useIsManager(): boolean {
  return useIsManagerStatus().isManager;
}
