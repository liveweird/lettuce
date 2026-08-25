import type { TargetDirection, TeamKpiValue } from "../api/teamkpis";

// One point of the KPI value-over-time series (epoch millis + the value recorded then).
export interface TeamKpiSeriesPoint {
  ts: number;
  value: number;
}

/**
 * Derives the Graph tab's value-over-time series from the KPI's data points — pure, so it is
 * unit-testable without recharts. Each point plots at its measurement date (ISO `YYYY-MM-DD` →
 * UTC-midnight millis), sorted ascending (the API returns newest first). Nothing is synthesized:
 * the series is exactly the collected data, so a single point renders as a dot and an empty list
 * yields an empty chart (the component shows its empty state instead).
 */
export function buildTeamKpiSeries(values: TeamKpiValue[]): TeamKpiSeriesPoint[] {
  return values
    .map((v) => ({ ts: Date.parse(v.date), value: v.value }))
    .sort((a, b) => a.ts - b.ts);
}

/**
 * The good-zone bounds for the Graph tab's tinted ReferenceArea (v2.41.0): from the target
 * upward for AT_LEAST, from the target downward for AT_MOST. BOTH bounds are explicit —
 * recharts resolves an unset y1/y2 to the domain's far (top) edge, which painted the AT_MOST
 * zone above the line (live-verified) — with the far bound pushed well past any plausible
 * y-domain; the chart clips it via `ifOverflow="hidden"`, so the tint always bleeds to the
 * plot edge on the good side. Pure, so the direction branch is unit-testable without recharts.
 */
export function goodZoneBounds(
  direction: TargetDirection,
  target: number,
): { y1: number; y2: number } {
  const reach = Math.max(Math.abs(target), 1) * 1000;
  return direction === "AT_LEAST"
    ? { y1: target, y2: target + reach }
    : { y1: target - reach, y2: target };
}
