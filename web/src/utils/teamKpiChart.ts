import type { TeamKpiEvent, TeamKpiResponse } from "../api/client";

// One point of the KPI value-over-time series (epoch millis + the value then recorded).
export interface TeamKpiSeriesPoint {
  ts: number;
  value: number;
}

/**
 * Derives the Graph tab's value-over-time series from the KPI's audit events — pure, so it is
 * unit-testable without recharts. The value starts at 0.0 when the KPI is created (no event
 * records the initial value), each PROGRESS_UPDATED event contributes its `to` value at its
 * timestamp, and a TYPE_CHANGED event contributes a 0.0 point (a type change resets the
 * recorded progress — the reset is a real value change the graph must show). Events arrive
 * oldest-first from the API; the origin is synthesized from `createdAt`.
 */
export function buildTeamKpiSeries(kpi: TeamKpiResponse, events: TeamKpiEvent[]): TeamKpiSeriesPoint[] {
  const points: TeamKpiSeriesPoint[] = [{ ts: kpi.createdAt, value: 0 }];
  for (const event of events) {
    if (event.type === "PROGRESS_UPDATED") {
      const value = Number(event.params?.to);
      if (Number.isFinite(value)) points.push({ ts: event.timestamp, value });
    } else if (event.type === "TYPE_CHANGED") {
      points.push({ ts: event.timestamp, value: 0 });
    }
  }
  return points;
}
