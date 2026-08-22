import { detailSearch } from "./linkSearch";

// Builders for every team-KPI-flow URL, so the query-string shape (and encodeURIComponent)
// lives in one place instead of being hand-assembled at call sites — the goalLinks pattern.
// Optional parts are appended only when given.

/** The KPI create screen, optionally prefilled with the team and a return target. */
export function teamKpiCreateLink(teamId?: number, teamName?: string | null, back?: string): string {
  const parts: string[] = [];
  if (teamId != null) parts.push(`teamId=${teamId}`);
  if (teamName) parts.push(`teamName=${encodeURIComponent(teamName)}`);
  if (back) parts.push(`back=${encodeURIComponent(back)}`);
  return `/team-kpis/new${parts.length ? `?${parts.join("&")}` : ""}`;
}

/** THE KPI screen (General / KPI data / Graph / History tabs; the manager edits data points inline). */
export function teamKpiViewLink(id: number, back?: string): string {
  return `/team-kpis/${id}/view${detailSearch(undefined, back)}`;
}

/** The DRAFT definition editor (everything else redirects to the view). */
export function teamKpiEditLink(id: number, back?: string): string {
  return `/team-kpis/${id}/edit${detailSearch(undefined, back)}`;
}

/** The per-team KPI drill-down (`/teams/:id/kpis`), as linked from Dashboard → My teams. */
export function teamKpisLink(teamId: number): string {
  return `/teams/${teamId}/kpis`;
}
