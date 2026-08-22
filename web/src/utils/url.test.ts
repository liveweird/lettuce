import { afterEach, describe, expect, test, vi } from "vitest";
import { safeBackParam, toRelativePath } from "./url";

describe("safeBackParam", () => {
  const of = (search: string) => new URLSearchParams(search);

  test("accepts an in-app path with query and hash", () => {
    expect(safeBackParam(of("back=/feedback?tab=provided"))).toBe("/feedback?tab=provided");
    expect(safeBackParam(of("back=%2Fusers%3Ftab%3Dpeers%23top"))).toBe("/users?tab=peers#top");
  });

  test("null when absent", () => {
    expect(safeBackParam(of(""))).toBeNull();
    expect(safeBackParam(of("other=1"))).toBeNull();
  });

  test("rejects an absolute cross-origin URL", () => {
    expect(safeBackParam(of("back=https%3A%2F%2Fevil.example%2Fphish"))).toBeNull();
    expect(safeBackParam(of("back=http://evil.example/phish"))).toBeNull();
  });

  test("rejects a protocol-relative URL (the //evil.example bypass)", () => {
    expect(safeBackParam(of("back=%2F%2Fevil.example%2Fphish"))).toBeNull();
  });

  test("rejects a scheme without slashes and relative junk", () => {
    expect(safeBackParam(of("back=javascript:alert(1)"))).toBeNull();
    expect(safeBackParam(of("back=feedback"))).toBeNull();
  });
});

describe("toRelativePath", () => {
  test("passes through an app-relative path", () => {
    expect(toRelativePath("/feedback/123/view")).toBe("/feedback/123/view");
  });

  test("keeps query string and hash", () => {
    expect(toRelativePath("/users?tab=peers#top")).toBe("/users?tab=peers#top");
  });

  test("strips the origin from an absolute same-origin URL", () => {
    // happy-dom default origin is http://localhost:3000
    expect(toRelativePath(`${window.location.origin}/teams/9/details`)).toBe("/teams/9/details");
  });

  test("drops a cross-origin host, keeping only the path (preserves our origin)", () => {
    expect(toRelativePath("https://evil.example.com:8443/feedback/1?x=2#z")).toBe(
      "/feedback/1?x=2#z",
    );
  });

  test("normalizes a relative value without a leading slash", () => {
    expect(toRelativePath("feedback/1")).toBe("/feedback/1");
  });

  describe("when URL parsing throws", () => {
    afterEach(() => vi.unstubAllGlobals());

    test("falls back to the raw value for an already-absolute path", () => {
      vi.stubGlobal(
        "URL",
        class {
          constructor() {
            throw new Error("boom");
          }
        },
      );
      expect(toRelativePath("/already/abs")).toBe("/already/abs");
    });

    test("prefixes a leading slash for a relative value", () => {
      vi.stubGlobal(
        "URL",
        class {
          constructor() {
            throw new Error("boom");
          }
        },
      );
      expect(toRelativePath("relative")).toBe("/relative");
    });
  });
});
