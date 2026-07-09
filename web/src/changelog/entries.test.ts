import { describe, expect, test } from "vitest";
import { APP_VERSION, CHANGELOG } from "./entries";

describe("changelog entries", () => {
  test("the app version is the newest entry's version", () => {
    expect(APP_VERSION).toBe(CHANGELOG[0].version);
  });

  test("entries are sorted newest first with strictly descending dates", () => {
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(CHANGELOG[i - 1].date > CHANGELOG[i].date).toBe(true);
    }
  });

  test("every entry has a version, an ISO date, and both language bodies", () => {
    for (const entry of CHANGELOG) {
      expect(entry.version).not.toBe("");
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.en.trim()).not.toBe("");
      expect(entry.pl.trim()).not.toBe("");
    }
  });
});
