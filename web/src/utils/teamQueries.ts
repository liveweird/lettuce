import type { QueryClient } from "@tanstack/react-query";

// Everything a dated team-structure write (a membership or manager period created, corrected or
// removed) can change: the team and its roster, the teams list, the org chart (every as-of
// date — the prefix key), both history pages and the person-side team lists. The one place the
// history writes invalidate from (the utils/<area>Queries.ts convention).
export async function invalidateTeamStructure(queryClient: QueryClient, teamId: number) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["team", teamId] }),
    queryClient.invalidateQueries({ queryKey: ["teamMembersList", teamId] }),
    queryClient.invalidateQueries({ queryKey: ["teamMemberships", teamId] }),
    queryClient.invalidateQueries({ queryKey: ["teamManagerPeriods", teamId] }),
    queryClient.invalidateQueries({ queryKey: ["teams"] }),
    queryClient.invalidateQueries({ queryKey: ["orgChart"] }),
    queryClient.invalidateQueries({ queryKey: ["userTeams"] }),
    queryClient.invalidateQueries({ queryKey: ["userTeamHistory"] }),
  ]);
}
