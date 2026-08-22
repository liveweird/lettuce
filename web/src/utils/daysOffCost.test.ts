import { describe, expect, test } from "vitest";
import { costHalfDays, formatDays, isWorkingDay } from "./daysOffCost";

// The fixed anchor week: Mon 2026-01-05 … Sun 2026-01-11 (2026-01-01 is a Thursday) — the
// same fixture the server-side DaysOffCostTest pins, so the two mirrors stay aligned.
describe("daysOffCost", () => {
  const none = new Set<string>();

  test("weekends and holidays are not working days", () => {
    expect(isWorkingDay("2026-01-05", none)).toBe(true); // Monday
    expect(isWorkingDay("2026-01-10", none)).toBe(false); // Saturday
    expect(isWorkingDay("2026-01-11", none)).toBe(false); // Sunday
    expect(isWorkingDay("2026-01-05", new Set(["2026-01-05"]))).toBe(false);
  });

  test("a full working week costs five days", () => {
    expect(costHalfDays("2026-01-05", "2026-01-09", false, false, none)).toBe(10);
  });

  test("weekends and holidays inside the period cost nothing", () => {
    expect(costHalfDays("2026-01-09", "2026-01-12", false, false, none)).toBe(4); // Fri..Mon
    expect(costHalfDays("2026-01-10", "2026-01-11", false, false, none)).toBe(0);
    expect(costHalfDays("2026-01-05", "2026-01-09", false, false, new Set(["2026-01-07"]))).toBe(8);
  });

  test("edge halves subtract only on counted working days", () => {
    expect(costHalfDays("2026-01-05", "2026-01-05", true, false, none)).toBe(1);
    expect(costHalfDays("2026-01-05", "2026-01-06", true, true, none)).toBe(2);
    // A half toggle on a Saturday edge subtracts nothing.
    expect(costHalfDays("2026-01-10", "2026-01-12", true, false, none)).toBe(2);
  });

  test("invalid ranges return null", () => {
    expect(costHalfDays("2026-01-09", "2026-01-05", false, false, none)).toBeNull();
    expect(costHalfDays("garbage", "2026-01-05", false, false, none)).toBeNull();
  });

  test("formatDays renders halves per locale", () => {
    expect(formatDays(1.5, "en")).toBe("1.5");
    expect(formatDays(2, "en")).toBe("2");
    expect(formatDays(1.5, "pl")).toBe("1,5");
  });

});
