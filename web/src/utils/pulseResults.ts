import type { TFunction } from "i18next";
import type { PulseCycle, PulseTrendPoint } from "../api/client";
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

/** The chart's series: only points whose eNPS is actually available, oldest first. */
export function buildTrendSeries(points: PulseTrendPoint[]): { closedAt: number; enps: number; n: number }[] {
  return points
    .filter((p) => p.availability === "OK" && p.enps != null)
    .map((p) => ({ closedAt: p.closedAt, enps: p.enps!, n: p.responseCount ?? 0 }));
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
