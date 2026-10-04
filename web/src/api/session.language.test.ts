import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { jsonResponse } from "../test/http";

// Deliberately does NOT import "../test/withPolish": every test imports a FRESH module graph (i18n, session,
// auth) whose Polish bundle starts unregistered, so these tests see the real lazy-loading behaviour of
// sign-in and of the session language chokepoint, independent of each other.

async function fresh() {
  vi.resetModules();
  const [i18n, session, auth] = await Promise.all([import("../i18n"), import("./session"), import("./auth")]);
  return { i18n: i18n.default, i18nModule: i18n, session, auth };
}

function tokenPair(overrides: Record<string, unknown> = {}) {
  return {
    token: "new-access",
    expiresAt: 1,
    refreshToken: "new-refresh",
    refreshExpiresAt: 2,
    roles: [] as string[],
    userId: 7,
    ...overrides,
  };
}

// The persist functions take the typed LoginResponse; the payloads here are deliberately partial.
const pair = (overrides: Record<string, unknown> = {}) => tokenPair(overrides) as never;

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.doUnmock("dayjs/locale/pl");
  vi.resetModules();
  localStorage.clear();
});

describe("language at sign-in (lazy bundles)", () => {
  test("login loads the stored language BEFORE the session starts — no English flash", async () => {
    const { i18n, session, auth } = await fresh();
    expect(i18n.hasResourceBundle("pl", "translation")).toBe(false);
    const bundleLoadedWhenSessionStarted: boolean[] = [];
    const unsubscribe = session.subscribeSessionChange(() => {
      bundleLoadedWhenSessionStarted.push(i18n.hasResourceBundle("pl", "translation"));
    });
    mockFetch.mockResolvedValue(jsonResponse(200, tokenPair({ language: "pl" })));
    try {
      await auth.login({ email: "a@b", password: "pw" });
    } finally {
      unsubscribe();
    }
    expect(bundleLoadedWhenSessionStarted[0]).toBe(true);
    await vi.waitFor(() => expect(i18n.resolvedLanguage).toBe("pl"));
    expect(i18n.t("common.action.create")).toBe("Utwórz");
  });

  test("the MFA step loads the stored language before the session starts too", async () => {
    const { i18n, session, auth } = await fresh();
    const seen: boolean[] = [];
    const unsubscribe = session.subscribeSessionChange(() => seen.push(i18n.hasResourceBundle("pl", "translation")));
    mockFetch.mockResolvedValue(jsonResponse(200, tokenPair({ language: "pl" })));
    try {
      await auth.verifyMfa("challenge", "123456");
    } finally {
      unsubscribe();
    }
    expect(seen[0]).toBe(true);
  });

  test("a slow bundle is waited for only up to the cap, then the session starts in English", async () => {
    vi.doMock("dayjs/locale/pl", () => new Promise(() => undefined));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { i18n, session, auth } = await fresh();
    mockFetch.mockResolvedValue(jsonResponse(200, tokenPair({ language: "pl" })));
    const pending = auth.login({ email: "a@b", password: "pw" });
    await vi.advanceTimersByTimeAsync(900);
    expect(session.getToken()).toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    await pending;
    expect(session.getToken()).toBe("new-access");
    expect(i18n.hasResourceBundle("pl", "translation")).toBe(false);
  });
});

describe("language across sessions (latest call wins)", () => {
  test("account A (pl) still loading when account B (en) signs in: B stays English", async () => {
    const { i18n, session } = await fresh();
    session.persistSession(pair({ userId: 1, language: "pl" }));
    session.persistSession(pair({ userId: 2, language: "en" }));
    await vi.waitFor(() => expect(i18n.hasResourceBundle("pl", "translation")).toBe(true));
    await new Promise((r) => setTimeout(r, 10));
    expect(i18n.resolvedLanguage).toBe("en");
    expect(localStorage.getItem("lettuce.lang")).toBe("en");
  });

  test("a refresh agreeing with the pending target does not supersede it; one that differs does", async () => {
    const { i18n, session } = await fresh();
    session.persistSession(pair({ language: "pl" }));
    // The same session refreshes while PL is still loading, carrying its (same) stored language.
    session.persistRefreshedSession(pair({ language: "pl" }));
    await vi.waitFor(() => expect(i18n.resolvedLanguage).toBe("pl"));
    // A refresh carrying an admin-changed language applies it.
    session.persistRefreshedSession(pair({ language: "en" }));
    await vi.waitFor(() => expect(i18n.resolvedLanguage).toBe("en"));
  });

  test("an older server without the language field leaves the language alone", async () => {
    const { i18n, session } = await fresh();
    session.persistSession(pair());
    await new Promise((r) => setTimeout(r, 10));
    expect(i18n.resolvedLanguage).toBe("en");
    expect(i18n.hasResourceBundle("pl", "translation")).toBe(false);
  });
});
