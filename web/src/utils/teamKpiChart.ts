import type { TeamKpiEvent, TeamKpiResponse } from "../api/client";

// One point of the KPI value-over-time series (epoch millis + the value then recorded).
export interface TeamKpiSeriesPoint {
  ts: number;
  value: number;
}

/**
 * Derives the Graph tab's value-over-time series from the KPI's audit events — pure, so it is
 * unit-testable without recharts. Each PROGRESS_UPDATED event contributes its `to` value at the
 * user-supplied measurement date (`params.date`, ISO YYYY-MM-DD → UTC-midnight millis; pre-v1.28
 * events carry no date and fall back to the event timestamp), and a TYPE_CHANGED event
 * contributes a 0.0 point at its timestamp (a type change resets the recorded progress — the
 * reset is a real value change the graph must show). Because values can be backdated, the points
 * are sorted by time; the 0.0 origin at `createdAt` (no event records the initial value) is
 * synthesized only when no recorded point predates it — a pre-creation backfill must not show a
 * dip to 0 at creation.
 */
export function buildTeamKpiSeries(kpi: TeamKpiResponse, events: TeamKpiEvent[]): TeamKpiSeriesPoint[] {
  const points: TeamKpiSeriesPoint[] = [];
  for (const event of events) {
    if (event.type === "PROGRESS_UPDATED") {
      const value = Number(event.params?.to);
      if (!Number.isFinite(value)) continue;
      const dated = event.params?.date ? Date.parse(event.params.date) : NaN;
      points.push({ ts: Number.isFinite(dated) ? dated : event.timestamp, value });
    } else if (event.type === "TYPE_CHANGED") {
      points.push({ ts: event.timestamp, value: 0 });
    }
  }
  if (!points.some((p) => p.ts <= kpi.createdAt)) {
    points.push({ ts: kpi.createdAt, value: 0 });
  }
  points.sort((a, b) => a.ts - b.ts);
  return points;
}
