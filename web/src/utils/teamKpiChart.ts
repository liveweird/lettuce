import type { TeamKpiValue } from "../api/teamkpis";

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
