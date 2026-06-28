import { describe, expect, test } from "vitest";
import { feedbackPartyName } from "./userDisplay";

// A stand-in for i18next's t: returns "You" for the self key and "Name (deleted)"
// for the deleted-suffix key, so assertions read clearly.
const t = (key: string, opts?: Record<string, unknown>): string => {
  if (key === "common.state.you") return "You";
  if (key === "feedback.deletedSuffix") return `${opts?.name} (deleted)`;
  return key;
};

describe("feedbackPartyName", () => {
  test("returns 'You' when the user is the current user", () => {
    expect(feedbackPartyName(7, "Alice", false, 7, t)).toBe("You");
  });

  test("'You' wins even when the (impossible) self row is flagged deleted", () => {
    expect(feedbackPartyName(7, "Alice", true, 7, t)).toBe("You");
  });

  test("returns the plain name for another, non-deleted user", () => {
    expect(feedbackPartyName(10, "Alice", false, 7, t)).toBe("Alice");
  });

  test("suffixes the name for a deleted other user", () => {
    expect(feedbackPartyName(10, "Alice", true, 7, t)).toBe("Alice (deleted)");
  });

  test("returns an em dash when there is no name", () => {
    expect(feedbackPartyName(null, null, false, 7, t)).toBe("—");
  });

  test("does not substitute 'You' when there is no current user id", () => {
    expect(feedbackPartyName(7, "Alice", false, null, t)).toBe("Alice");
  });

  test("does not substitute 'You' when the user id is missing", () => {
    expect(feedbackPartyName(null, "Alice", false, 7, t)).toBe("Alice");
  });
});
