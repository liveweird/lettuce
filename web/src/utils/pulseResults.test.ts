import { describe, expect, test } from "vitest";
import type { TFunction } from "i18next";
import {
  PULSE_SMALL_SAMPLE,
  addIsoDays,
  buildTrendComparisonRows,
  buildTrendSeries,
  closedCycleOptions,
  deltaColor,
  enpsBandColor,
  enpsBandKey,
  formatSigned,
  trendMetricDomain,
  trendSeriesKey,
} from "./pulseResults";
import type { PulseCycle, PulseTrendPoint } from "../api/client";

describe("delta presentation", () => {
  test("improvements teal, declines red, flat or absent dimmed", () => {
    expect(deltaColor(12)).toBe("teal");
    expect(deltaColor(-3)).toBe("red");
    expect(deltaColor(0)).toBe("gray");
    expect(deltaColor(null)).toBe("gray");
  });

  test("formatSigned carries an explicit plus", () => {
    expect(formatSigned(12)).toBe("+12");
    expect(formatSigned(-3)).toBe("-3");
    expect(formatSigned(0)).toBe("0");
    expect(formatSigned(1.65, 1)).toBe("+1.6");
  });
});

describe("eNPS band context (v2.6.2)", () => {
  test("bands split at 0, 20, and 50 — approximate industry framing", () => {
    expect(enpsBandKey(-1)).toBe("concern");
    expect(enpsBandKey(-100)).toBe("concern");
    expect(enpsBandKey(0)).toBe("okay");
    expect(enpsBandKey(20)).toBe("okay");
    expect(enpsBandKey(21)).toBe("good");
    expect(enpsBandKey(50)).toBe("good");
    expect(enpsBandKey(51)).toBe("excellent");
    expect(enpsBandKey(100)).toBe("excellent");
  });

  test("colors: red for concern, dimmed neutral, teal for healthy — never brand green", () => {
    expect(enpsBandColor(-10)).toBe("red");
    expect(enpsBandColor(10)).toBe("dimmed");
    expect(enpsBandColor(33)).toBe("teal");
    expect(enpsBandColor(80)).toBe("teal");
  });

  test("the small-sample hint threshold is ten responses", () => {
    expect(PULSE_SMALL_SAMPLE).toBe(10);
  });
});

describe("buildTrendSeries", () => {
  test("keeps only OK points with a score, in order", () => {
    const points: PulseTrendPoint[] = [
      { cycleId: 1, closedAt: 100, availability: "OK", enps: 40, responseCount: 5, responseRate: 80 },
      { cycleId: 2, closedAt: 200, availability: "NOT_ENOUGH_RESPONSES", enps: null, responseCount: 2, responseRate: 40 },
      { cycleId: 3, closedAt: 300, availability: "NOT_A_RESPONDENT", enps: null, responseCount: null, responseRate: null },
      { cycleId: 4, closedAt: 400, availability: "OK", enps: -10, responseCount: 6, responseRate: 100 },
    ];
    expect(buildTrendSeries(points)).toEqual([
      { closedAt: 100, enps: 40, n_enps: 5 },
      { closedAt: 400, enps: -10, n_enps: 6 },
    ]);
  });
});

describe("trend comparison builders (v2.11.0)", () => {
  const p = (
    cycleId: number,
    closedAt: number,
    availability: PulseTrendPoint["availability"],
    enps: number | null,
    favorableQ2: number | null,
    responseCount: number | null,
  ): PulseTrendPoint => ({
    cycleId,
    closedAt,
    availability,
    enps,
    responseCount,
    responseRate: responseCount == null ? null : 100,
    favorableQ2,
    favorableQ3: null,
    favorableQ4: null,
    favorableQ5: null,
  });
  const direct = {
    teamId: 11,
    teamName: "P",
    mode: "direct" as const,
    points: [p(1, 100, "OK", 40, 75.0, 4), p(2, 200, "OK", 50, 80.0, 5)],
  };
  const child = {
    teamId: 21,
    teamName: "A",
    mode: "subtree" as const,
    points: [p(1, 100, "NOT_ENOUGH_RESPONSES", null, null, 2), p(2, 200, "OK", -10, 33.3, 3)],
  };

  test("trendSeriesKey is the (teamId, mode) pair — the parent appears twice", () => {
    expect(trendSeriesKey(direct)).toBe("t11_direct");
    expect(trendSeriesKey({ teamId: 11, mode: "subtree" })).toBe("t11_subtree");
    expect(trendSeriesKey(child)).toBe("t21_subtree");
  });

  test("rows carry per-series metric columns, n_ counts, and gaps for unavailable points", () => {
    const rows = buildTrendComparisonRows([direct, child], "enps");
    expect(rows).toEqual([
      { closedAt: 100, t11_direct: 40, n_t11_direct: 4, t21_subtree: undefined, n_t21_subtree: 2 },
      { closedAt: 200, t11_direct: 50, n_t11_direct: 5, t21_subtree: -10, n_t21_subtree: 3 },
    ]);
  });

  test("a driver metric reads the favorable% and an absent value stays a gap", () => {
    const rows = buildTrendComparisonRows([direct, child], "q2");
    expect(rows[0].t11_direct).toBe(75.0);
    expect(rows[1].t21_subtree).toBeCloseTo(33.3, 5);
    // Q3 was never delivered in this fixture — null even on OK points → gap, not zero.
    expect(buildTrendComparisonRows([direct], "q3")[0].t11_direct).toBeUndefined();
  });

  test("trendMetricDomain: eNPS spans the signed scale, drivers the percent scale", () => {
    expect(trendMetricDomain("enps")).toEqual([-100, 100]);
    expect(trendMetricDomain("q4")).toEqual([0, 100]);
  });

  test("no series yields no rows", () => {
    expect(buildTrendComparisonRows([], "enps")).toEqual([]);
  });
});

describe("closedCycleOptions", () => {
  test("closed cycles only, newest first", () => {
    const cycles = [
      { id: 1, status: "CLOSED", plannedOpenDate: "2026-01-01", plannedCloseDate: "2026-01-08", closedAt: 100, createdAt: 0, lastModified: 0 },
      { id: 2, status: "OPEN", plannedOpenDate: "2026-02-01", plannedCloseDate: "2026-02-08", createdAt: 0, lastModified: 0 },
      { id: 3, status: "CLOSED", plannedOpenDate: "2026-03-01", plannedCloseDate: "2026-03-08", closedAt: 300, createdAt: 0, lastModified: 0 },
      { id: 4, status: "CANCELLED", plannedOpenDate: "2026-04-01", plannedCloseDate: "2026-04-08", createdAt: 0, lastModified: 0 },
    ] as PulseCycle[];
    const options = closedCycleOptions(cycles, "en", ((key: string) => key) as unknown as TFunction);
    expect(options.map((o) => o.value)).toEqual(["3", "1"]);
  });
});

describe("addIsoDays", () => {
  test("pure ISO date arithmetic, month and year rollover included", () => {
    expect(addIsoDays("2026-08-01", 7)).toBe("2026-08-08");
    expect(addIsoDays("2026-08-29", 28)).toBe("2026-09-26");
    expect(addIsoDays("2026-12-25", 14)).toBe("2027-01-08");
    expect(addIsoDays("garbage", 7)).toBe("garbage");
  });
});
