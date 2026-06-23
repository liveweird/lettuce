import { afterEach, describe, expect, test, vi } from "vitest";
import { formatTimestamp, lastModifiedCutoff } from "./datetime";

describe("formatTimestamp", () => {
  test("formats local time as YYYY-MM-DD HH:mm with zero-padding", () => {
    // Built from local components so the assertion is timezone-independent.
    const ms = new Date(2026, 0, 5, 9, 7).getTime(); // Jan 5 2026, 09:07 local
    expect(formatTimestamp(ms)).toBe("2026-01-05 09:07");
  });

  test("renders two-digit month/day/hour/minute without extra padding", () => {
    const ms = new Date(2026, 10, 23, 18, 45).getTime(); // Nov 23 2026, 18:45 local
    expect(formatTimestamp(ms)).toBe("2026-11-23 18:45");
  });
});

describe("lastModifiedCutoff", () => {
  const NOW = 1_700_000_000_000;
  const DAY = 24 * 60 * 60 * 1000;

  afterEach(() => vi.restoreAllMocks());

  test("'all' applies no bound", () => {
    expect(lastModifiedCutoff("all")).toBeUndefined();
  });

  test("'week' is now minus 7 days", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    expect(lastModifiedCutoff("week")).toBe(NOW - 7 * DAY);
  });

  test("'month' is now minus 30 days", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    expect(lastModifiedCutoff("month")).toBe(NOW - 30 * DAY);
  });

  test("recomputes against the current clock on each call", () => {
    const spy = vi.spyOn(Date, "now").mockReturnValue(NOW);
    expect(lastModifiedCutoff("week")).toBe(NOW - 7 * DAY);
    spy.mockReturnValue(NOW + DAY);
    expect(lastModifiedCutoff("week")).toBe(NOW + DAY - 7 * DAY);
  });
});
