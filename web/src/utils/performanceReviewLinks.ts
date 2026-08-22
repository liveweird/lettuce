import { detailSearch, drillDownOptsSearch, type DrillDownOpts } from "./linkSearch";

// Builders for every /performance-reviews/* and /users/:id/performance-reviews URL (the
// goalLinks idiom) — never hand-assemble these paths in pages.

/** The create screen; `subordinateId`/`subordinateName` prefill (and lock) the report picker,
 * `back` overrides where Cancel/save return to. */
export function reviewCreateLink(
  subordinateId?: number,
  subordinateName?: string | null,
  back?: string,
): string {
  const parts: string[] = [];
  if (subordinateId != null) parts.push(`subordinateId=${subordinateId}`);
  if (subordinateName) parts.push(`subordinateName=${encodeURIComponent(subordinateName)}`);
  if (back) parts.push(`back=${encodeURIComponent(back)}`);
  return `/performance-reviews/new${parts.length ? `?${parts.join("&")}` : ""}`;
}

export function reviewViewLink(id: number, from?: string, back?: string): string {
  return `/performance-reviews/${id}/view${detailSearch(from, back)}`;
}

export function reviewEditLink(id: number, from?: string, back?: string): string {
  return `/performance-reviews/${id}/edit${detailSearch(from, back)}`;
}

/** The per-user reviews drill-down; `audit` adds ?mode=audit (honored for HR callers only). */
export function userPerformanceReviewsLink(
  userId: number,
  name: string,
  from: string,
  teamId?: number,
  audit?: boolean,
  opts?: DrillDownOpts,
): string {
  let url = `/users/${userId}/performance-reviews?name=${encodeURIComponent(name)}&from=${from}`;
  if (teamId != null) url += `&teamId=${teamId}`;
  if (audit) url += `&mode=audit`;
  return url + drillDownOptsSearch(opts);
}
