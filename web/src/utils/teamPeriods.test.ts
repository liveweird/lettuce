import { describe, expect, test } from "vitest";
import { newestFirstPeriods, periodStatus } from "./teamPeriods";

describe("periodStatus", () => {
  test("the server's current flag wins; a later start is upcoming; everything else is past", () => {
    expect(periodStatus({ startDate: null, current: true }, "2026-10-14")).toBe("current");
    expect(periodStatus({ startDate: "2026-11-01", current: false }, "2026-10-14")).toBe("upcoming");
    expect(periodStatus({ startDate: "2026-01-01", current: false }, "2026-10-14")).toBe("past");
    // An open start ("since before records") is never upcoming.
    expect(periodStatus({ startDate: null, current: false }, "2026-10-14")).toBe("past");
    // The server's flag is trusted even for a future-looking start; without a `today` it is todayIsoDate().
    expect(periodStatus({ startDate: "2999-01-01", current: true }, "2026-10-14")).toBe("current");
    expect(periodStatus({ startDate: "2999-01-01", current: false })).toBe("upcoming");
  });
});

describe("newestFirstPeriods", () => {
  test("newest start first, a null start (oldest) last, ties by id descending", () => {
    const rows = [
      { id: 1, startDate: null },
      { id: 2, startDate: "2026-01-01" },
      { id: 4, startDate: "2026-06-01" },
      { id: 3, startDate: "2026-06-01" },
    ];
    expect(newestFirstPeriods(rows).map((r) => r.id)).toEqual([4, 3, 2, 1]);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 4, 3]); // input untouched
  });
});
