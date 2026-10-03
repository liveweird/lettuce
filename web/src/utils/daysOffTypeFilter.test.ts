import { describe, expect, test } from "vitest";
import { hasPoolPick, isTypePick, livePicks, nextTypePicks, typePicksToQuery } from "./daysOffTypeFilter";

describe("daysOffTypeFilter", () => {
  test("isTypePick accepts PAID, UNPAID and pool:<id> only", () => {
    for (const ok of ["PAID", "UNPAID", "pool:7"]) expect(isTypePick(ok)).toBe(true);
    for (const bad of ["", "paid", "pool:", "pool:x", "pool:7a", null, 7, undefined]) {
      expect(isTypePick(bad)).toBe(false);
    }
  });

  test("typePicksToQuery maps picks onto the type set and the paid-only pool narrowing", () => {
    expect(typePicksToQuery([])).toEqual({ type: undefined, poolTypeId: undefined });
    expect(typePicksToQuery(["PAID"])).toEqual({ type: ["PAID"], poolTypeId: undefined });
    expect(typePicksToQuery(["UNPAID"])).toEqual({ type: ["UNPAID"], poolTypeId: undefined });
    // A pool pick brings PAID into the type set (never a pool beside a PAID-less set — a 400).
    expect(typePicksToQuery(["pool:3"])).toEqual({ type: ["PAID"], poolTypeId: [3] });
    expect(typePicksToQuery(["UNPAID", "pool:3", "pool:5"])).toEqual({
      type: ["PAID", "UNPAID"],
      poolTypeId: [3, 5],
    });
    // "All paid" wins over any pool left in storage: no narrowing is sent.
    expect(typePicksToQuery(["PAID", "pool:3"])).toEqual({ type: ["PAID"], poolTypeId: undefined });
  });

  test("nextTypePicks: the last pick wins between All paid and a pool; Unpaid is independent", () => {
    expect(nextTypePicks(["pool:3", "UNPAID"], ["pool:3", "UNPAID", "PAID"])).toEqual(["UNPAID", "PAID"]);
    expect(nextTypePicks(["PAID", "UNPAID"], ["PAID", "UNPAID", "pool:3"])).toEqual(["UNPAID", "pool:3"]);
    expect(nextTypePicks(["PAID"], ["PAID", "UNPAID"])).toEqual(["PAID", "UNPAID"]);
    // A removal passes through untouched.
    expect(nextTypePicks(["pool:3", "pool:5"], ["pool:5"])).toEqual(["pool:5"]);
  });

  test("livePicks drops archived pools only once the registry has loaded", () => {
    expect(livePicks(["pool:9", "UNPAID"], undefined)).toEqual(["pool:9", "UNPAID"]);
    expect(livePicks(["pool:9", "pool:1", "PAID"], [1])).toEqual(["pool:1", "PAID"]);
  });

  test("hasPoolPick", () => {
    expect(hasPoolPick(["PAID", "UNPAID"])).toBe(false);
    expect(hasPoolPick(["pool:1"])).toBe(true);
  });
});
