import { describe, expect, test } from "vitest";
import { pickLocalized } from "./localized";

describe("pickLocalized", () => {
  test("picks the viewer's language when a translation exists", () => {
    const values = { en: "Software Engineer", pl: "Inżynier oprogramowania" };
    expect(pickLocalized(values, "en")).toBe("Software Engineer");
    expect(pickLocalized(values, "pl")).toBe("Inżynier oprogramowania");
  });

  test("falls back to English for a missing, unknown, or undefined language", () => {
    const values = { en: "Software Engineer" };
    expect(pickLocalized(values, "pl")).toBe("Software Engineer");
    expect(pickLocalized(values, "de")).toBe("Software Engineer");
    expect(pickLocalized(values, undefined)).toBe("Software Engineer");
  });

  test("a blank translation falls back to English too", () => {
    expect(pickLocalized({ en: "Engineering", pl: "   " }, "pl")).toBe("Engineering");
  });
});
