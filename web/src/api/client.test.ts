import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  ApiError,
  authedFetch,
  canAudit,
  getRoles,
  getToken,
  isHr,
  getUserId,
  isAdmin,
  listFeedbacks,
  login,
  logout,
  setToken,
} from "./client";
import { consumeSignedOut } from "../auth";
import { jsonResponse } from "../test/http";

function tokenPair(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    token: "new-access",
    expiresAt: 1,
    refreshToken: "new-refresh",
    refreshExpiresAt: 2,
    roles: [],
    userId: 7,
    ...overrides,
  };
}

const TOKEN_KEY = "lettuce.auth.token";
const REFRESH_TOKEN_KEY = "lettuce.auth.refreshToken";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;


let mockFetch: FetchMock;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("session accessors", () => {
  test("setToken / getToken round-trip and clear", () => {
    expect(getToken()).toBeNull();
    setToken("abc");
    expect(getToken()).toBe("abc");
    setToken(null);
    expect(getToken()).toBeNull();
  });

  test("getRoles filters unknown values and survives corrupt storage; isAdmin reflects it", () => {
    expect(getRoles()).toEqual([]);
    localStorage.setItem(ROLE_KEY, "not-json{");
    expect(getRoles()).toEqual([]);
    localStorage.setItem(ROLE_KEY, JSON.stringify({ nope: true }));
    expect(getRoles()).toEqual([]);
    localStorage.setItem(ROLE_KEY, JSON.stringify(["BOGUS", "ADMIN"]));
    expect(getRoles()).toEqual(["ADMIN"]);
    expect(isAdmin()).toBe(true);
    localStorage.setItem(ROLE_KEY, "[]");
    expect(isAdmin()).toBe(false);
  });

  test("HR is a known role; isHr and canAudit reflect it without granting isAdmin", () => {
    localStorage.setItem(ROLE_KEY, JSON.stringify(["HR"]));
    expect(getRoles()).toEqual(["HR"]);
    expect(isHr()).toBe(true);
    expect(canAudit()).toBe(true);
    expect(isAdmin()).toBe(false);
    localStorage.setItem(ROLE_KEY, JSON.stringify(["ADMIN"]));
    expect(isHr()).toBe(false);
    expect(canAudit()).toBe(true);
  });

  test("getUserId parses a finite number or returns null", () => {
    expect(getUserId()).toBeNull();
    localStorage.setItem(USER_ID_KEY, "not-a-number");
    expect(getUserId()).toBeNull();
    localStorage.setItem(USER_ID_KEY, "42");
    expect(getUserId()).toBe(42);
  });
});

describe("login", () => {
  test("stores access token, refresh token, roles and userId on success", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        token: "jwt-123",
        expiresAt: 1,
        refreshToken: "refresh-123",
        refreshExpiresAt: 2,
        roles: ["ADMIN"],
        userId: 7,
      }),
    );
    const data = await login({ email: "a@b", password: "pw" });
    expect(data.token).toBe("jwt-123");
    expect(localStorage.getItem(TOKEN_KEY)).toBe("jwt-123");
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("refresh-123");
    expect(localStorage.getItem(ROLE_KEY)).toBe(JSON.stringify(["ADMIN"]));
    expect(localStorage.getItem(USER_ID_KEY)).toBe("7");
  });

  test("throws ApiError carrying status and body on failure", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(401, { type: "about:blank", title: "Unauthorized", status: 401, detail: "no" }),
    );
    await expect(login({ email: "a@b", password: "bad" })).rejects.toMatchObject({
      status: 401,
      body: { type: "about:blank", title: "Unauthorized", status: 401, detail: "no" },
    });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});

describe("logout", () => {
  test("posts the bearer token and refresh token, then clears the session", async () => {
    localStorage.setItem(TOKEN_KEY, "jwt-123");
    localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-123");
    localStorage.setItem(ROLE_KEY, JSON.stringify(["ADMIN"]));
    // A pre-roles-set session may still carry the legacy single-role key; clearSession removes it too.
    localStorage.setItem("lettuce.auth.role", "ADMIN");
    localStorage.setItem(USER_ID_KEY, "7");
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));

    await logout();

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/logout");
    expect((init as RequestInit).method).toBe("POST");
    expect(new Headers((init as RequestInit).headers).get("Authorization")).toBe("Bearer jwt-123");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ refreshToken: "refresh-123" });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(ROLE_KEY)).toBeNull();
    expect(localStorage.getItem("lettuce.auth.role")).toBeNull();
    expect(localStorage.getItem(USER_ID_KEY)).toBeNull();
  });

  test("is a no-op when there is no token", async () => {
    await logout();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("authedFetch", () => {
  test("attaches the bearer token and a JSON Content-Type for bodies", async () => {
    localStorage.setItem(TOKEN_KEY, "jwt-123");
    mockFetch.mockResolvedValue(jsonResponse(200, {}));

    await authedFetch("/api/v1/users/1", { method: "PUT", body: JSON.stringify({ name: "x" }) });

    const [, init] = mockFetch.mock.calls[0];
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("Authorization")).toBe("Bearer jwt-123");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  test("clears the session on a 401 when there is no refresh token", async () => {
    localStorage.setItem(TOKEN_KEY, "jwt-123");
    localStorage.setItem(ROLE_KEY, JSON.stringify(["ADMIN"]));
    mockFetch.mockResolvedValue(jsonResponse(401, { title: "Unauthorized", status: 401 }));

    const res = await authedFetch("/api/v1/users");
    expect(res.status).toBe(401);
    // No refresh token → no /refresh attempt, just the original call.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(ROLE_KEY)).toBeNull();
  });

  test("on 401, silently refreshes and retries the original request once", async () => {
    localStorage.setItem(TOKEN_KEY, "old-access");
    localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-123");
    mockFetch
      .mockResolvedValueOnce(jsonResponse(401, { title: "Unauthorized", status: 401 })) // original
      .mockResolvedValueOnce(jsonResponse(200, tokenPair())) // /refresh
      .mockResolvedValueOnce(jsonResponse(200, { ok: true })); // retry

    const res = await authedFetch("/api/v1/users");

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(String(mockFetch.mock.calls[1][0])).toContain("/api/v1/refresh");
    // The retry carries the freshly minted access token.
    const retryInit = mockFetch.mock.calls[2][1] as RequestInit;
    expect(new Headers(retryInit.headers).get("Authorization")).toBe("Bearer new-access");
    expect(localStorage.getItem(TOKEN_KEY)).toBe("new-access");
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("new-refresh");
  });

  test("on 401, a rejected refresh clears the session and flags signed-out", async () => {
    consumeSignedOut(); // reset any leaked flag from earlier tests
    localStorage.setItem(TOKEN_KEY, "old-access");
    localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-123");
    mockFetch
      .mockResolvedValueOnce(jsonResponse(401, { title: "Unauthorized", status: 401 })) // original
      .mockResolvedValueOnce(jsonResponse(401, { title: "Unauthorized", status: 401 })); // /refresh rejects

    const res = await authedFetch("/api/v1/users");

    expect(res.status).toBe(401);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    expect(consumeSignedOut()).toBe(true);
  });

  test("concurrent 401s trigger exactly one refresh (single-flight)", async () => {
    localStorage.setItem(TOKEN_KEY, "old-access");
    localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-123");
    let userCalls = 0;
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/api/v1/refresh")) {
        return Promise.resolve(jsonResponse(200, tokenPair()));
      }
      userCalls += 1;
      // The two originals 401; the two retries (after refresh) succeed.
      return Promise.resolve(
        userCalls <= 2 ? jsonResponse(401, { status: 401 }) : jsonResponse(200, { ok: true }),
      );
    });

    const [a, b] = await Promise.all([
      authedFetch("/api/v1/users"),
      authedFetch("/api/v1/users"),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const refreshCalls = mockFetch.mock.calls.filter((c) =>
      String(c[0]).includes("/api/v1/refresh"),
    );
    expect(refreshCalls).toHaveLength(1);
  });

  test("omits the Authorization header when no token is stored", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, {}));
    await authedFetch("/api/v1/users");
    const [, init] = mockFetch.mock.calls[0];
    expect(new Headers((init as RequestInit).headers).has("Authorization")).toBe(false);
  });
});

describe("listFeedbacks serialization", () => {
  test("always sends view/page/pageSize, omits undefined, and encodes lastModified[gte]", async () => {
    localStorage.setItem(TOKEN_KEY, "jwt-123");
    mockFetch.mockResolvedValue(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));

    await listFeedbacks({
      view: "received",
      page: 2,
      pageSize: 40,
      sort: "-lastModified",
      lastModifiedGte: 1700000000000,
      // subjectName intentionally omitted → must not appear in the query string.
    });

    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain("view=received");
    expect(url).toContain("page=2");
    expect(url).toContain("pageSize=40");
    expect(url).toContain("sort=-lastModified");
    expect(url).toContain("lastModified%5Bgte%5D=1700000000000");
    expect(url).not.toContain("subjectName");
  });
});

describe("ApiError", () => {
  test("carries status and body", () => {
    const err = new ApiError(404, { message: "missing" });
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(404);
    expect(err.body).toEqual({ message: "missing" });
  });
});
