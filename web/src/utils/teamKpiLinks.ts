import { detailSearch } from "./linkSearch";

// Builders for every team-KPI-flow URL, so the query-string shape (and encodeURIComponent)
// lives in one place instead of being hand-assembled at call sites — the goalLinks pattern.
// Optional parts are appended only when given.

/** The KPI create screen, optionally prefilled with the team and a return target. */
export function teamKpiCreateLink(teamId?: number, back?: string, cancel?: string): string {
  const parts: string[] = [];
  if (teamId != null) parts.push(`teamId=${teamId}`);
  if (back) parts.push(`back=${encodeURIComponent(back)}`);
  if (cancel) parts.push(`cancel=${encodeURIComponent(cancel)}`);
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

/** The per-team KPI drill-down (`/teams/:id/kpis`), as linked from Dashboard → My teams, or —
 * with `from: "team"` (v3.24.0) — from the team-details page, whose link the page's back anchor
 * returns to. `back` (v4.6.0) is the exact in-app URL to return to (it wins the destination; the
 * page sanitizes it via `safeBackParam`) — how the team page's own origin survives the detour. */
export function teamKpisLink(teamId: number, opts?: { from?: "team"; back?: string }): string {
  const query = new URLSearchParams();
  if (opts?.from) query.set("from", opts.from);
  if (opts?.back) query.set("back", opts.back);
  const queryString = query.toString();
  return `/teams/${teamId}/kpis${queryString ? `?${queryString}` : ""}`;
}
