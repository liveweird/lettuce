import { describe, expect, test } from "vitest";
import { toRelativePath } from "./url";

describe("toRelativePath", () => {
  test("passes through an app-relative path", () => {
    expect(toRelativePath("/feedback/123/view")).toBe("/feedback/123/view");
  });

  test("keeps query string and hash", () => {
    expect(toRelativePath("/users?tab=peers#top")).toBe("/users?tab=peers#top");
  });

  test("strips the origin from an absolute same-origin URL", () => {
    // happy-dom default origin is http://localhost:3000
    expect(toRelativePath(`${window.location.origin}/teams/9/members`)).toBe("/teams/9/members");
  });

  test("drops a cross-origin host, keeping only the path (preserves our origin)", () => {
    expect(toRelativePath("https://evil.example.com:8443/feedback/1?x=2#z")).toBe(
      "/feedback/1?x=2#z",
    );
  });

  test("normalizes a relative value without a leading slash", () => {
    expect(toRelativePath("feedback/1")).toBe("/feedback/1");
  });
});
