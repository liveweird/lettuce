// The query-string primitives shared by the per-feature link-builder modules (feedbackLinks,
// goalLinks, oneOnOneLinks, performanceReviewLinks, teamKpiLinks) — extracted so the feature
// modules stop importing from each other (2026-08 review round; detailSearch used to live
// byte-identical in two of them, DrillDownOpts in feedbackLinks).

/**
 * Optional drill-down addressing shared by the four per-user drill-down builders
 * (feedbacks/1:1s/goals/reviews): `back` overrides the screen's "Back to …" target — the
 * details-page round-trip, where `from` alone would lose the details page's own origin —
 * and `manages` asserts the caller-manages relationship (`manages=1`) so `from=details`
 * keeps the manager-only affordances (New goal / New 1:1 / New review).
 */
export type DrillDownOpts = { back?: string; manages?: boolean };

/** Serializes [DrillDownOpts] as a `&`-prefixed query suffix ("" when empty). */
export function drillDownOptsSearch(opts?: DrillDownOpts): string {
  let suffix = "";
  if (opts?.back) suffix += `&back=${encodeURIComponent(opts.back)}`;
  if (opts?.manages) suffix += `&manages=1`;
  return suffix;
}

/** The view/edit detail screens' `?from=…&back=…` suffix ("" when both are absent). */
export function detailSearch(from?: string, back?: string): string {
  const parts: string[] = [];
  if (from) parts.push(`from=${from}`);
  if (back) parts.push(`back=${encodeURIComponent(back)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}
