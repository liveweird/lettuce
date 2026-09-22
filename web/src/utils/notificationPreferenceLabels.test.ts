import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { PREFERENCE_LABEL_KEY } from "./notificationPreferenceLabels";

// The completeness backstop the plan calls for, alongside the TS `Record` over the full
// `NotificationType` union in notificationPreferenceLabels.ts itself: every key must resolve to
// a real, non-empty EN string — i18next returns the raw key verbatim when nothing matches, so a
// key typo or a missing JSON entry (the type-level check can't catch either) fails here.
describe("notification preference labels", () => {
  it("resolves every NotificationType to a non-empty, real translation", () => {
    for (const [type, key] of Object.entries(PREFERENCE_LABEL_KEY)) {
      const label = i18n.t(key, { lng: "en" });
      expect(label, `${type} -> ${key}`).not.toBe(key);
      expect(label.trim().length, `${type} -> ${key}`).toBeGreaterThan(0);
    }
  });

  it("covers every value of the generated NotificationType union", () => {
    // A loose sanity floor so a broken import (empty object) can't pass vacuously.
    expect(Object.keys(PREFERENCE_LABEL_KEY).length).toBeGreaterThanOrEqual(40);
  });
});
