import { describe, expect, test } from "vitest";
import type { TFunction } from "i18next";
import { addIsoDays, buildTrendSeries, closedCycleOptions, deltaColor, formatSigned } from "./pulseResults";
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

describe("buildTrendSeries", () => {
  test("keeps only OK points with a score, in order", () => {
    const points: PulseTrendPoint[] = [
      { cycleId: 1, closedAt: 100, availability: "OK", enps: 40, responseCount: 5, responseRate: 80 },
      { cycleId: 2, closedAt: 200, availability: "NOT_ENOUGH_RESPONSES", enps: null, responseCount: 2, responseRate: 40 },
      { cycleId: 3, closedAt: 300, availability: "NOT_A_RESPONDENT", enps: null, responseCount: null, responseRate: null },
      { cycleId: 4, closedAt: 400, availability: "OK", enps: -10, responseCount: 6, responseRate: 100 },
    ];
    expect(buildTrendSeries(points)).toEqual([
      { closedAt: 100, enps: 40, n: 5 },
      { closedAt: 400, enps: -10, n: 6 },
    ]);
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
