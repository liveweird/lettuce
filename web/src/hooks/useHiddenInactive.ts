import { useQuery } from "@tanstack/react-query";
import { listTeamMembers, type TeamMemberListQuery } from "../api/teams";

type Probe = Omit<TeamMemberListQuery, "page" | "pageSize" | "sort" | "deactivated">;

/**
 * Whether an EMPTY person-card grid under the default Active filter is actually hiding someone:
 * one pageSize-1 probe with the grid's other filters plus `deactivated=true`. It runs only while
 * the grid is empty at the default (`enabled`), so a populated grid costs nothing extra, and
 * the "inactive people are hidden" hint never shows when nobody is.
 */
export function useHiddenInactive(probe: Probe, enabled: boolean): boolean {
  const { data } = useQuery({
    queryKey: ["teamMembers", "hiddenInactive", probe],
    queryFn: () => listTeamMembers({ ...probe, page: 1, pageSize: 1, deactivated: true }),
    enabled,
  });
  return enabled && (data?.total ?? 0) > 0;
}
