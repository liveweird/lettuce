import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  ApiError,
  authedFetch,
  getRole,
  getToken,
  getUserId,
  isAdmin,
  listFeedbacks,
  login,
  logout,
  setToken,
} from "./client";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

  test("getRole only accepts known roles; isAdmin reflects it", () => {
    expect(getRole()).toBeNull();
    localStorage.setItem(ROLE_KEY, "BOGUS");
    expect(getRole()).toBeNull();
    localStorage.setItem(ROLE_KEY, "ADMIN");
    expect(getRole()).toBe("ADMIN");
    expect(isAdmin()).toBe(true);
    localStorage.setItem(ROLE_KEY, "USER");
    expect(isAdmin()).toBe(false);
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
  test("stores token, role and userId on success", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, { token: "jwt-123", role: "ADMIN", userId: 7 }),
    );
    const data = await login({ email: "a@b", password: "pw" });
    expect(data.token).toBe("jwt-123");
    expect(localStorage.getItem(TOKEN_KEY)).toBe("jwt-123");
    expect(localStorage.getItem(ROLE_KEY)).toBe("ADMIN");
    expect(localStorage.getItem(USER_ID_KEY)).toBe("7");
  });

  test("throws ApiError carrying status and body on failure", async () => {
    mockFetch.mockResolvedValue(jsonResponse(401, { error: "unauthorized", message: "no" }));
    await expect(login({ email: "a@b", password: "bad" })).rejects.toMatchObject({
      status: 401,
      body: { error: "unauthorized", message: "no" },
    });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});

describe("logout", () => {
  test("posts with the bearer token then clears the session", async () => {
    localStorage.setItem(TOKEN_KEY, "jwt-123");
    localStorage.setItem(ROLE_KEY, "ADMIN");
    localStorage.setItem(USER_ID_KEY, "7");
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));

    await logout();

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/logout");
    expect((init as RequestInit).method).toBe("POST");
    expect(new Headers((init as RequestInit).headers).get("Authorization")).toBe("Bearer jwt-123");
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(ROLE_KEY)).toBeNull();
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

    await authedFetch("/api/users/1", { method: "PUT", body: JSON.stringify({ name: "x" }) });

    const [, init] = mockFetch.mock.calls[0];
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("Authorization")).toBe("Bearer jwt-123");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  test("clears the session on a 401 response", async () => {
    localStorage.setItem(TOKEN_KEY, "jwt-123");
    localStorage.setItem(ROLE_KEY, "ADMIN");
    mockFetch.mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));

    const res = await authedFetch("/api/users");
    expect(res.status).toBe(401);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(ROLE_KEY)).toBeNull();
  });

  test("omits the Authorization header when no token is stored", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, {}));
    await authedFetch("/api/users");
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
