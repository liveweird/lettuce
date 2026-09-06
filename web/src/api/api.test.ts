import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError, authedFetch, jsonRequest, shouldRetryQuery } from "./http";
import {
  canAudit,
  getDisabledFeatures,
  getRoles,
  getToken,
  hasFeature,
  isHr,
  getUserId,
  isAdmin,
  SessionChangedError,
  setToken,
  subscribeSessionBoundary,
  subscribeSessionChange,
} from "./session";
import { login, logout, verifyMfa } from "./auth";
import { setUserLanguage, updateUserFeatures } from "./users";
import i18n from "../i18n";
import { listFeedbacks } from "./feedbacks";
import { consumeSignedOut } from "../auth";
import { jsonResponse } from "../test/http";
import { QueryClient } from "@tanstack/react-query";

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
const DISABLED_FEATURES_KEY = "lettuce.auth.disabledFeatures";

type FetchMock = ReturnType<typeof vi.fn>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}


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

  test("HR is a known role; canAudit is HR-only — ADMIN does not audit", () => {
    localStorage.setItem(ROLE_KEY, JSON.stringify(["HR"]));
    expect(getRoles()).toEqual(["HR"]);
    expect(isHr()).toBe(true);
    expect(canAudit()).toBe(true);
    expect(isAdmin()).toBe(false);
    localStorage.setItem(ROLE_KEY, JSON.stringify(["ADMIN"]));
    expect(isHr()).toBe(false);
    expect(canAudit()).toBe(false);
    expect(isAdmin()).toBe(true);
  });

  test("getUserId parses a finite number or returns null", () => {
    expect(getUserId()).toBeNull();
    localStorage.setItem(USER_ID_KEY, "not-a-number");
    expect(getUserId()).toBeNull();
    localStorage.setItem(USER_ID_KEY, "42");
    expect(getUserId()).toBe(42);
  });

  test("getDisabledFeatures defaults to all-enabled and survives corrupt storage", () => {
    // Missing key (a pre-v1.53.0 session) = full access.
    expect(getDisabledFeatures()).toEqual([]);
    expect(hasFeature("GOALS")).toBe(true);
    localStorage.setItem(DISABLED_FEATURES_KEY, "not-json{");
    expect(getDisabledFeatures()).toEqual([]);
    localStorage.setItem(DISABLED_FEATURES_KEY, JSON.stringify({ nope: true }));
    expect(getDisabledFeatures()).toEqual([]);
    localStorage.setItem(DISABLED_FEATURES_KEY, JSON.stringify(["WIZARDRY", "GOALS"]));
    expect(getDisabledFeatures()).toEqual(["GOALS"]);
    expect(hasFeature("GOALS")).toBe(false);
    expect(hasFeature("FEEDBACKS")).toBe(true);
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
    expect("token" in data && data.token).toBe("jwt-123");
    expect(localStorage.getItem(TOKEN_KEY)).toBe("jwt-123");
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("refresh-123");
    expect(localStorage.getItem(ROLE_KEY)).toBe(JSON.stringify(["ADMIN"]));
    expect(localStorage.getItem(USER_ID_KEY)).toBe("7");
    // A mid-deploy older server without the field still persists a valid (empty) set.
    expect(localStorage.getItem(DISABLED_FEATURES_KEY)).toBe("[]");
  });

  test("stores the disabled-features set from the login payload", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, tokenPair({ disabledFeatures: ["GOALS", "DAYS_OFF"] })),
    );
    await login({ email: "a@b", password: "pw" });
    expect(localStorage.getItem(DISABLED_FEATURES_KEY)).toBe(JSON.stringify(["GOALS", "DAYS_OFF"]));
    expect(hasFeature("GOALS")).toBe(false);
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

  test("applies the stored language to the UI on login and skips a language-less payload", async () => {
    try {
      // The V61 sync: the server's stored language wins over the device default.
      mockFetch.mockResolvedValue(jsonResponse(200, tokenPair({ language: "pl" })));
      await login({ email: "a@b", password: "pw" });
      expect(i18n.resolvedLanguage).toBe("pl");

      // A mid-deploy older server without the field leaves the UI language untouched.
      await i18n.changeLanguage("en");
      mockFetch.mockResolvedValue(jsonResponse(200, tokenPair()));
      await login({ email: "a@b", password: "pw" });
      expect(i18n.resolvedLanguage).toBe("en");
    } finally {
      // The suite renders English globally — never leak a flipped instance.
      await i18n.changeLanguage("en");
    }
  });

  test("a delayed login or MFA response cannot overwrite an intervening session boundary", async () => {
    const loginResponse = deferred<Response>();
    mockFetch.mockReturnValueOnce(loginResponse.promise);
    const delayedLogin = login({ email: "a@b", password: "pw" });
    await logout();
    loginResponse.resolve(jsonResponse(200, tokenPair({ token: "stale-login" })));
    await expect(delayedLogin).rejects.toBeInstanceOf(SessionChangedError);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();

    const mfaResponse = deferred<Response>();
    mockFetch.mockReturnValueOnce(mfaResponse.promise);
    const delayedMfa = verifyMfa("challenge-a", "123456");
    await logout();
    mfaResponse.resolve(jsonResponse(200, tokenPair({ token: "stale-mfa" })));
    await expect(delayedMfa).rejects.toBeInstanceOf(SessionChangedError);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});

describe("setUserLanguage", () => {
  test("PUTs the language to the dedicated endpoint", async () => {
    setToken("t");
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    await setUserLanguage(7, "pl");
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/users/7/language");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ language: "pl" });
  });
});

describe("updateUserFeatures", () => {
  test("PUTs the wholesale set; a self-edit updates the stored session flags", async () => {
    localStorage.setItem(TOKEN_KEY, "jwt-123");
    localStorage.setItem(USER_ID_KEY, "7");
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    await updateUserFeatures(7, ["GOALS"]);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/users/7/features");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ disabledFeatures: ["GOALS"] });
    expect(localStorage.getItem(DISABLED_FEATURES_KEY)).toBe(JSON.stringify(["GOALS"]));
  });

  test("editing ANOTHER user's flags leaves the admin's own session untouched", async () => {
    localStorage.setItem(TOKEN_KEY, "jwt-123");
    localStorage.setItem(USER_ID_KEY, "7");
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    await updateUserFeatures(8, ["GOALS"]);
    expect(localStorage.getItem(DISABLED_FEATURES_KEY)).toBeNull();
  });

  test("a failed PUT never touches the stored flags", async () => {
    localStorage.setItem(TOKEN_KEY, "jwt-123");
    localStorage.setItem(USER_ID_KEY, "7");
    mockFetch.mockResolvedValue(jsonResponse(403, { title: "Forbidden", status: 403 }));
    await expect(updateUserFeatures(7, ["GOALS"])).rejects.toMatchObject({ status: 403 });
    expect(localStorage.getItem(DISABLED_FEATURES_KEY)).toBeNull();
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

  test("clears the session even when the revoke request fails (offline logout)", async () => {
    // Pre-v2.22.0 a rejected fetch skipped clearSession, leaving live tokens behind.
    localStorage.setItem(TOKEN_KEY, "jwt-123");
    localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-123");
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    await logout();

    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
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

  test("on 401, a network-failed refresh KEEPS the session — a blip is not a sign-out", async () => {
    consumeSignedOut();
    localStorage.setItem(TOKEN_KEY, "old-access");
    localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-123");
    mockFetch
      .mockResolvedValueOnce(jsonResponse(401, { status: 401 })) // original
      .mockRejectedValueOnce(new TypeError("Failed to fetch")); // /refresh unreachable

    const res = await authedFetch("/api/v1/users");

    // The caller sees the 401 (their query errors), but the still-valid tokens survive.
    expect(res.status).toBe(401);
    expect(localStorage.getItem(TOKEN_KEY)).toBe("old-access");
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("refresh-123");
    expect(consumeSignedOut()).toBe(false);
  });

  test("on 401, a rate-limited (429) or erroring (500) refresh keeps the session too", async () => {
    for (const status of [429, 500]) {
      localStorage.setItem(TOKEN_KEY, "old-access");
      localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-123");
      mockFetch.mockReset();
      mockFetch
        .mockResolvedValueOnce(jsonResponse(401, { status: 401 }))
        .mockResolvedValueOnce(jsonResponse(status, { status }));

      const res = await authedFetch("/api/v1/users");

      expect(res.status).toBe(401);
      expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("refresh-123");
    }
  });

  test("a malformed 200 refresh body neither crashes nor signs out", async () => {
    localStorage.setItem(TOKEN_KEY, "old-access");
    localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-123");
    mockFetch
      .mockResolvedValueOnce(jsonResponse(401, { status: 401 }))
      .mockResolvedValueOnce(new Response("<html>proxy error page</html>", { status: 200 }));

    const res = await authedFetch("/api/v1/users");

    expect(res.status).toBe(401);
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("refresh-123");
  });

  test.each([null, { token: "incomplete" }])(
    "an incomplete JSON refresh body keeps the existing session: %j",
    async (body) => {
      localStorage.setItem(TOKEN_KEY, "old-access");
      localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-123");
      mockFetch
        .mockResolvedValueOnce(jsonResponse(401, {}))
        .mockResolvedValueOnce(jsonResponse(200, body));

      await expect(authedFetch("/api/v1/users")).resolves.toMatchObject({ status: 401 });
      expect(localStorage.getItem(TOKEN_KEY)).toBe("old-access");
      expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("refresh-123");
    },
  );

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

  test("an ordinary successful response remains valid across a same-session refresh", async () => {
    localStorage.setItem(TOKEN_KEY, "old-access");
    localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-123");
    localStorage.setItem(USER_ID_KEY, "7");
    const ordinaryResponse = deferred<Response>();
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/ordinary")) return ordinaryResponse.promise;
      if (path.includes("/refresh")) return Promise.resolve(jsonResponse(200, tokenPair()));
      const token = new Headers(init?.headers).get("Authorization");
      return Promise.resolve(
        token === "Bearer new-access" ? jsonResponse(200, {}) : jsonResponse(401, {}),
      );
    });

    const ordinary = authedFetch("/api/v1/ordinary");
    await expect(authedFetch("/api/v1/needs-refresh")).resolves.toMatchObject({ status: 200 });
    ordinaryResponse.resolve(jsonResponse(200, { saved: true }));

    await expect(ordinary).resolves.toMatchObject({ status: 200 });
  });

  test("a refresh that changes authorization metadata creates a cache boundary", async () => {
    localStorage.setItem(TOKEN_KEY, "old-access");
    localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-123");
    localStorage.setItem(USER_ID_KEY, "7");
    const client = new QueryClient();
    client.setQueryData(["private", 7], { secret: "a" });
    const unsubscribe = subscribeSessionBoundary(() => client.clear());
    mockFetch
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(200, tokenPair({ roles: ["ADMIN"] })))
      .mockResolvedValueOnce(jsonResponse(200, {}));

    await expect(authedFetch("/api/v1/users")).resolves.toMatchObject({ status: 200 });

    expect(client.getQueryData(["private", 7])).toBeUndefined();
    expect(getRoles()).toEqual(["ADMIN"]);
    unsubscribe();
  });

  test.each([200, 401])(
    "a delayed refresh status %i cannot restore or clear a newer login",
    async (refreshStatus) => {
      localStorage.setItem(TOKEN_KEY, "a-access");
      localStorage.setItem(REFRESH_TOKEN_KEY, "a-refresh");
      localStorage.setItem(USER_ID_KEY, "7");
      const refreshResponse = deferred<Response>();
      const logoutResponse = deferred<Response>();

      mockFetch.mockImplementation((url: string, init?: RequestInit) => {
        const path = String(url);
        if (path.includes("/api/v1/users")) return Promise.resolve(jsonResponse(401, {}));
        if (path.includes("/api/v1/refresh")) return refreshResponse.promise;
        if (path.includes("/api/v1/logout")) return logoutResponse.promise;
        if (path.includes("/api/v1/login")) {
          expect(JSON.parse(String(init?.body))).toEqual({ email: "b@b", password: "pw" });
          return Promise.resolve(jsonResponse(200, tokenPair({
            token: "b-access",
            refreshToken: "b-refresh",
            userId: 8,
          })));
        }
        throw new Error(`Unexpected fetch ${path}`);
      });

      const oldRequest = authedFetch("/api/v1/users");
      await vi.waitFor(() => {
        expect(mockFetch.mock.calls.some(([url]) => String(url).includes("/refresh"))).toBe(true);
      });
      const revoke = logout();
      expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
      await login({ email: "b@b", password: "pw" });

      refreshResponse.resolve(
        refreshStatus === 200
          ? jsonResponse(200, tokenPair({ token: "stale-a", refreshToken: "stale-r", userId: 7 }))
          : jsonResponse(401, {}),
      );
      await expect(oldRequest).rejects.toBeInstanceOf(SessionChangedError);
      expect(localStorage.getItem(TOKEN_KEY)).toBe("b-access");
      expect(localStorage.getItem(USER_ID_KEY)).toBe("8");

      logoutResponse.resolve(new Response(null, { status: 204 }));
      await revoke;
      expect(localStorage.getItem(TOKEN_KEY)).toBe("b-access");
    },
  );

  test("an old ordinary response cannot complete after another identity logs in", async () => {
    localStorage.setItem(TOKEN_KEY, "a-access");
    localStorage.setItem(REFRESH_TOKEN_KEY, "a-refresh");
    localStorage.setItem(USER_ID_KEY, "7");
    const oldResponse = deferred<Response>();
    mockFetch.mockImplementation((url: string) => {
      const path = String(url);
      if (path.includes("/api/v1/users")) return oldResponse.promise;
      if (path.includes("/api/v1/logout")) return Promise.resolve(new Response(null, { status: 204 }));
      if (path.includes("/api/v1/login")) {
        return Promise.resolve(jsonResponse(200, tokenPair({
          token: "b-access",
          refreshToken: "b-refresh",
          userId: 8,
        })));
      }
      throw new Error(`Unexpected fetch ${path}`);
    });

    const request = authedFetch("/api/v1/users");
    await logout();
    await login({ email: "b@b", password: "pw" });
    oldResponse.resolve(jsonResponse(200, { secret: "user-a" }));

    await expect(request).rejects.toBeInstanceOf(SessionChangedError);
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes("/refresh"))).toBe(false);
  });

  test("a delayed response body cannot escape into a newer session", async () => {
    localStorage.setItem(TOKEN_KEY, "a-access");
    localStorage.setItem(REFRESH_TOKEN_KEY, "a-refresh");
    localStorage.setItem(USER_ID_KEY, "7");
    const body = deferred<unknown>();
    const response = {
      ok: true,
      status: 200,
      json: () => body.promise,
    } as Response;
    mockFetch.mockImplementation((url: string) => String(url).includes("/login")
      ? Promise.resolve(jsonResponse(200, tokenPair({
          token: "b-access",
          refreshToken: "b-refresh",
          userId: 8,
        })))
      : Promise.resolve(response));

    const oldRequest = jsonRequest<{ secret: string }>("/api/v1/private");
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    await logout();
    await login({ email: "b@b", password: "pw" });
    body.resolve({ secret: "user-a" });

    await expect(oldRequest).rejects.toBeInstanceOf(SessionChangedError);
  });

  test("a new session starts its own refresh while the old session's flight is pending", async () => {
    localStorage.setItem(TOKEN_KEY, "a-access");
    localStorage.setItem(REFRESH_TOKEN_KEY, "a-refresh");
    localStorage.setItem(USER_ID_KEY, "7");
    const oldRefresh = deferred<Response>();
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.includes("/api/v1/logout")) return Promise.resolve(new Response(null, { status: 204 }));
      if (path.includes("/api/v1/login")) {
        return Promise.resolve(jsonResponse(200, tokenPair({
          token: "b-access",
          refreshToken: "b-refresh",
          userId: 8,
        })));
      }
      if (path.includes("/api/v1/refresh")) {
        const body = JSON.parse(String(init?.body)) as { refreshToken: string };
        return body.refreshToken === "a-refresh"
          ? oldRefresh.promise
          : Promise.resolve(jsonResponse(200, tokenPair({
              token: "b-fresh",
              refreshToken: "b-refresh-2",
              userId: 8,
            })));
      }
      const authorization = new Headers(init?.headers).get("Authorization");
      return Promise.resolve(
        authorization === "Bearer b-fresh" ? jsonResponse(200, { ok: true }) : jsonResponse(401, {}),
      );
    });

    const oldRequest = authedFetch("/api/v1/users");
    await vi.waitFor(() => {
      expect(mockFetch.mock.calls.some(([url]) => String(url).includes("/refresh"))).toBe(true);
    });
    await logout();
    await login({ email: "b@b", password: "pw" });
    await expect(authedFetch("/api/v1/users")).resolves.toMatchObject({ status: 200 });

    oldRefresh.resolve(jsonResponse(200, tokenPair({ token: "stale-a", userId: 7 })));
    await expect(oldRequest).rejects.toBeInstanceOf(SessionChangedError);
    expect(localStorage.getItem(TOKEN_KEY)).toBe("b-fresh");
  });

  test("expiry clears query and mutation caches before auth observers see the transition", async () => {
    localStorage.setItem(TOKEN_KEY, "a-access");
    localStorage.setItem(USER_ID_KEY, "7");
    const client = new QueryClient();
    client.setQueryData(["private", 7], { secret: "a" });
    client.getMutationCache().build(client, { mutationFn: async () => undefined });
    const unsubscribeBoundary = subscribeSessionBoundary(() => client.clear());
    const observedSizes: Array<[number, number]> = [];
    const unsubscribeSession = subscribeSessionChange(() => {
      observedSizes.push([
        client.getQueryCache().getAll().length,
        client.getMutationCache().getAll().length,
      ]);
    });
    mockFetch.mockImplementation((url: string) => String(url).includes("/login")
      ? Promise.resolve(jsonResponse(200, tokenPair({
          token: "b-access",
          refreshToken: "b-refresh",
          userId: 8,
        })))
      : Promise.resolve(jsonResponse(401, {})));

    await authedFetch("/api/v1/users");
    await login({ email: "b@b", password: "pw" });

    expect(observedSizes.at(-1)).toEqual([0, 0]);
    expect(client.getQueryData(["private", 7])).toBeUndefined();
    unsubscribeSession();
    unsubscribeBoundary();
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

  test("exposes the ProblemDetail detail and instance when the body carries them", () => {
    const err = new ApiError(409, { detail: "Unique id already in use", instance: "/api/v1/x/3" });
    expect(err.detail).toBe("Unique id already in use");
    expect(err.instance).toBe("/api/v1/x/3");
    expect(new ApiError(500, null).detail).toBeUndefined();
    expect(new ApiError(502, "<html>").instance).toBeUndefined();
    expect(new ApiError(400, { detail: 42 }).detail).toBeUndefined();
  });
});

describe("shouldRetryQuery", () => {
  test("never retries a 4xx; transient failures retry at most twice", () => {
    expect(shouldRetryQuery(0, new ApiError(403, null))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError(404, null))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError(400, null))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError(500, null))).toBe(true);
    expect(shouldRetryQuery(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetryQuery(1, new ApiError(503, null))).toBe(true);
    expect(shouldRetryQuery(2, new ApiError(503, null))).toBe(false);
    expect(shouldRetryQuery(0, new SessionChangedError())).toBe(false);
  });
});
