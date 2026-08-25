import { describe, expect, test } from "vitest";
import { formatTargetDelta, formatTargetValue, meetsTarget } from "./goalValues";

describe("formatTargetValue", () => {
  test("prefixes the direction glyph — ≥ for AT_LEAST, ≤ for AT_MOST", () => {
    expect(formatTargetValue("NUMBER", 10, "AT_LEAST", "en")).toBe("≥ 10");
    expect(formatTargetValue("PERCENTAGE", 5, "AT_MOST", "en")).toBe("≤ 5%");
  });

  test("directionless values fall back to the plain rendering", () => {
    expect(formatTargetValue("NUMBER", 10, null, "en")).toBe("10");
    expect(formatTargetValue("PLAN", null, null, "en")).toBe("—");
  });
});

describe("meetsTarget", () => {
  test("AT_LEAST is good at or above the target", () => {
    expect(meetsTarget("AT_LEAST", 12, 10)).toBe(true);
    expect(meetsTarget("AT_LEAST", 10, 10)).toBe(true);
    expect(meetsTarget("AT_LEAST", 9, 10)).toBe(false);
  });

  test("AT_MOST is good at or below the target", () => {
    expect(meetsTarget("AT_MOST", 3, 5)).toBe(true);
    expect(meetsTarget("AT_MOST", 5, 5)).toBe(true);
    expect(meetsTarget("AT_MOST", 7, 5)).toBe(false);
  });
});

describe("formatTargetDelta", () => {
  test("signs the distance from the target, %-suffixed for PERCENTAGE", () => {
    expect(formatTargetDelta("NUMBER", 12, 10, "en")).toBe("+2");
    expect(formatTargetDelta("PERCENTAGE", 3, 5, "en")).toBe("-2%");
  });

  test("exactly on target renders an unsigned zero", () => {
    expect(formatTargetDelta("NUMBER", 10, 10, "en")).toBe("0");
  });
});
