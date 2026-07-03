import { describe, expect, test } from "vitest";
import { generatePassword } from "./password";

describe("generatePassword", () => {
  test("returns 16 chars from the URL-safe alphabet by default", () => {
    const pw = generatePassword();
    expect(pw).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  test("respects a custom length", () => {
    expect(generatePassword(32)).toHaveLength(32);
  });

  test("two calls do not collide", () => {
    expect(generatePassword()).not.toBe(generatePassword());
  });
});
