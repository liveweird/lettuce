import { describe, expect, test } from "vitest";
import type { TeamKpiValue } from "../api/client";
import { buildTeamKpiSeries } from "./teamKpiChart";

const value = (id: number, date: string, v: number): TeamKpiValue => ({ id, date, value: v });

describe("buildTeamKpiSeries", () => {
  test("plots each data point at its measurement date, oldest first", () => {
    // The API returns newest first — the series flips to chronological order.
    const series = buildTeamKpiSeries([
      value(2, "2026-07-10", 5),
      value(1, "2026-07-01", 2.5),
    ]);
    expect(series).toEqual([
      { ts: Date.parse("2026-07-01"), value: 2.5 },
      { ts: Date.parse("2026-07-10"), value: 5 },
    ]);
  });

  test("a single data point yields a single-point series (rendered as a dot)", () => {
    expect(buildTeamKpiSeries([value(1, "2026-07-01", 30)])).toEqual([
      { ts: Date.parse("2026-07-01"), value: 30 },
    ]);
  });

  test("an empty list yields an empty series — nothing is synthesized", () => {
    expect(buildTeamKpiSeries([])).toEqual([]);
  });
});
