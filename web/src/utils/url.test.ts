import { afterEach, describe, expect, test, vi } from "vitest";
import { boundedReturnPath, inAppPath, MAX_RETURN_PATH_LENGTH, safeBackParam, readFromParam, safeCancelParam, toRelativePath } from "./url";

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

describe("back-slash and cancel sanitizing", () => {
  const of = (search: string) => new URLSearchParams(search);

  test("rejects a slash-backslash host (the /\\evil.example bypass)", () => {
    expect(safeBackParam(of("back=%2F%5Cevil.example"))).toBeNull();
    expect(safeCancelParam(of("cancel=%2F%5Cevil.example"))).toBeNull();
    expect(inAppPath("/\\evil.example")).toBeNull();
  });

  test("inAppPath accepts in-app paths and null-passes null", () => {
    expect(inAppPath("/users?x=1")).toBe("/users?x=1");
    expect(inAppPath(null)).toBeNull();
  });

  test("rejects a backslash anywhere, not only after the leading slash", () => {
    expect(inAppPath("/a\\b")).toBeNull();
  });

  test("rejects ASCII control characters the URL parser would strip (/TAB/host bypass)", () => {
    // WHATWG URL parsing removes tab/CR/LF anywhere, so "/\t/evil.example" resolves to
    // "//evil.example" — a cross-origin target React Router would hand to location.assign.
    for (const encoded of ["%2F%09%2Fevil.example", "%2F%0A%2Fevil.example", "%2F%0D%2Fevil.example"]) {
      expect(safeBackParam(of(`back=${encoded}`))).toBeNull();
      expect(safeCancelParam(of(`cancel=${encoded}`))).toBeNull();
    }
    expect(inAppPath("/users\u0000")).toBeNull();
    expect(inAppPath("/users\u007f")).toBeNull();
  });

  test("rejects an over-long value but keeps a long legitimate one", () => {
    expect(inAppPath(`/users?q=${"a".repeat(2048)}`)).toBeNull();
    expect(inAppPath(`/users?q=${"a".repeat(1000)}`)).toBe(`/users?q=${"a".repeat(1000)}`);
  });

  test("cancel is accepted and rejected like back", () => {
    expect(safeCancelParam(of("cancel=%2Fgoals%3Ftab%3Down"))).toBe("/goals?tab=own");
    expect(safeCancelParam(of(""))).toBeNull();
    expect(safeCancelParam(of("cancel=%2F%2Fevil.example"))).toBeNull();
    expect(safeCancelParam(of("cancel=https%3A%2F%2Fevil.example"))).toBeNull();
    expect(safeCancelParam(of("cancel=goals"))).toBeNull();
    // back is not cancel
    expect(safeCancelParam(of("back=/goals"))).toBeNull();
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

describe("boundedReturnPath", () => {
  test("returns a short path unchanged", () => {
    expect(boundedReturnPath("/teams/3/details?from=org")).toBe("/teams/3/details?from=org");
  });

  test("past the limit drops only the nested back/cancel, keeping the rest of the query", () => {
    const long = `/users/9/details?name=Jane&from=members&teamId=3&back=${encodeURIComponent(`/x?q=${"a".repeat(MAX_RETURN_PATH_LENGTH)}`)}`;
    expect(boundedReturnPath(long)).toBe("/users/9/details?name=Jane&from=members&teamId=3");
    expect(boundedReturnPath(`/goals/new?cancel=${"b".repeat(MAX_RETURN_PATH_LENGTH)}`)).toBe("/goals/new");
  });

  test("a user <-> team round trip repeated many times never outgrows the bound", async () => {
    // The loop the review simulated: every hop wraps the previous URL in back= and re-encodes
    // it, so unbounded it grows quadratically (~4 KB after ten cycles). Mirrors the app: a
    // PersonCell/TeamBadge sends the bounded current path, a details page its bounded backHere.
    const { userDetailsLink } = await import("./userLinks");
    const { teamDetailsLink } = await import("./teamLinks");
    let current = "/feedback?tab=received";
    let longest = 0;
    for (let cycle = 0; cycle < 50; cycle++) {
      current = boundedReturnPath(teamDetailsLink(3, { back: current }));
      longest = Math.max(longest, current.length);
      current = boundedReturnPath(userDetailsLink(9, "Jane Doe", undefined, undefined, { back: current }));
      longest = Math.max(longest, current.length);
      expect(inAppPath(current)).toBe(current);
    }
    expect(longest).toBeLessThanOrEqual(MAX_RETURN_PATH_LENGTH);
  });
});

describe("readFromParam", () => {
  test("returns the raw origin key, null when absent", () => {
    expect(readFromParam(new URLSearchParams("from=team&x=1"))).toBe("team");
    expect(readFromParam(new URLSearchParams("x=1"))).toBeNull();
  });
});
