import type { TFunction } from "i18next";
import type { PulseCycle, PulseTrendPoint, PulseTrendResponse } from "../api/client";
import { formatIsoDate } from "./datetime";

/** Delta presentation: improvements teal, declines red, flat/absent dimmed (never "significant"). */
export function deltaColor(delta: number | null | undefined): "teal" | "red" | "gray" {
  if (delta == null || delta === 0) return "gray";
  return delta > 0 ? "teal" : "red";
}

/** Signed number for deltas — an explicit plus so "+12" and "−3" read as changes. */
export function formatSigned(value: number, digits = 0): string {
  const fixed = value.toFixed(digits);
  return value > 0 ? `+${fixed}` : fixed;
}

/** Below this many responses the card shows the volatility hint: at n=3 one person switching
 *  bands moves eNPS by ±33 points, so small-scope swings must not be over-read (v2.6.2). */
export const PULSE_SMALL_SAMPLE = 10;

/**
 * Contextual band for the eNPS headline (v2.6.2) — approximate industry conventions, not
 * science: below 0 is a concern, 0–20 okay, 21–50 good, above 50 excellent. Colors follow
 * the design language: red = concern, dimmed neutral, semantic teal = healthy (never the
 * brand green).
 */
export function enpsBandKey(score: number): "concern" | "okay" | "good" | "excellent" {
  if (score < 0) return "concern";
  if (score <= 20) return "okay";
  if (score <= 50) return "good";
  return "excellent";
}

export function enpsBandColor(score: number): "red" | "dimmed" | "teal" {
  const band = enpsBandKey(score);
  if (band === "concern") return "red";
  if (band === "okay") return "dimmed";
  return "teal";
}

/** The card mini-chart's series: only points whose eNPS is actually available, oldest first.
 *  The count column is n_enps — the generalized chart's `n_<seriesName>` tooltip convention. */
export function buildTrendSeries(points: PulseTrendPoint[]): { closedAt: number; enps: number; n_enps: number }[] {
  return points
    .filter((p) => p.availability === "OK" && p.enps != null)
    .map((p) => ({ closedAt: p.closedAt, enps: p.enps!, n_enps: p.responseCount ?? 0 }));
}

/** The Trend tab's metric picker: eNPS plus the fixed drivers' favorable% (the rotating
 *  question deliberately has no trend — it changes between cycles). */
export const TREND_METRICS = ["enps", "q2", "q3", "q4", "q5"] as const;
export type TrendMetric = (typeof TREND_METRICS)[number];

/** Stable, dot-free recharts dataKey for one comparison series. The (teamId, mode) PAIR is
 *  the identity — the parent team appears twice (direct + subtree). */
export function trendSeriesKey(series: Pick<PulseTrendResponse, "teamId" | "mode">): string {
  return `t${series.teamId}_${series.mode}`;
}

export function trendMetricDomain(metric: TrendMetric): [number, number] {
  return metric === "enps" ? [-100, 100] : [0, 100];
}

function metricValue(point: PulseTrendPoint, metric: TrendMetric): number | null | undefined {
  switch (metric) {
    case "enps":
      return point.enps;
    case "q2":
      return point.favorableQ2;
    case "q3":
      return point.favorableQ3;
    case "q4":
      return point.favorableQ4;
    case "q5":
      return point.favorableQ5;
  }
}

/**
 * Chart rows for the multi-series comparison, keyed by closedAt: one column per series
 * holding the picked metric on its OK points (undefined = line gap — withheld, not-responded,
 * or an all-NA driver), plus an `n_<seriesKey>` column with that point's response count for
 * the tooltip. Every series covers the same closed-cycle list, so rows zip by cycleId.
 */
export function buildTrendComparisonRows(
  series: PulseTrendResponse[],
  metric: TrendMetric,
): Record<string, number | undefined>[] {
  const first = series[0];
  if (first == null) return [];
  return first.points.map((anchor, index) => {
    const row: Record<string, number | undefined> = { closedAt: anchor.closedAt };
    for (const s of series) {
      const point = s.points[index];
      if (point == null || point.cycleId !== anchor.cycleId) continue;
      const key = trendSeriesKey(s);
      const value = point.availability === "OK" ? metricValue(point, metric) : null;
      row[key] = value ?? undefined;
      if (point.responseCount != null) row[`n_${key}`] = point.responseCount;
    }
    return row;
  });
}

/** Closed cycles as Select options, newest first, labeled by close date. */
export function closedCycleOptions(
  cycles: PulseCycle[],
  locale: string,
  t: TFunction,
): { value: string; label: string }[] {
  return cycles
    .filter((c) => c.status === "CLOSED")
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
    .map((c) => ({
      value: String(c.id),
      label: t("pulse.results.cycleOption", {
        date: c.closedAt != null ? formatIsoDate(new Date(c.closedAt).toISOString().slice(0, 10), locale) : c.plannedCloseDate,
      }),
    }));
}

/** ISO date arithmetic for the admin form prefill (UTC-safe: pure date strings in, out). */
export function addIsoDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
