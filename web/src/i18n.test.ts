import { afterEach, describe, expect, it, vi } from "vitest";
import dayjs from "dayjs";

// Every test below imports a FRESH copy of ./i18n (EN only, nothing registered, its own load/token state)
// so the lazy paths are exercised for real instead of being masked by an earlier load.
async function freshI18n() {
  vi.resetModules();
  return import("./i18n");
}

afterEach(() => {
  vi.doUnmock("dayjs/locale/pl");
  vi.resetModules();
  localStorage.removeItem("lettuce.lang");
});

describe("lazy language bundles", () => {
  it("a fresh instance ships only EN; loadLanguage registers PL once and shares the load", async () => {
    const fresh = await freshI18n();
    expect(fresh.default.hasResourceBundle("pl", "translation")).toBe(false);
    const first = fresh.loadLanguage("pl");
    expect(fresh.loadLanguage("pl")).toBe(first);
    await first;
    expect(fresh.default.hasResourceBundle("pl", "translation")).toBe(true);
    // Registered: the fast path, no new load.
    await expect(fresh.loadLanguage("pl")).resolves.toBeUndefined();
  });

  it("mounts the renamed areas under their EN keys (goals.json -> goal) and registers the dayjs locale", async () => {
    const fresh = await freshI18n();
    await fresh.loadLanguage("pl");
    const pl = fresh.default.getResourceBundle("pl", "translation") as Record<string, unknown>;
    expect(Object.keys(pl)).toEqual(expect.arrayContaining(["goal", "teamKpi", "performanceReview", "dictionary", "common"]));
    expect(pl).not.toHaveProperty("goals");
    expect(dayjs.Ls).toHaveProperty("pl");
  });

  it("loadLanguage('en') resolves without registering anything", async () => {
    const fresh = await freshI18n();
    await expect(fresh.loadLanguage("en")).resolves.toBeUndefined();
    expect(fresh.default.hasResourceBundle("pl", "translation")).toBe(false);
  });

  it("a failed load is not cached: the next call retries and succeeds", async () => {
    let failing = true;
    vi.doMock("dayjs/locale/pl", () => {
      if (failing) throw new Error("chunk 404");
      return {};
    });
    const fresh = await freshI18n();
    await expect(fresh.loadLanguage("pl")).rejects.toThrow();
    expect(fresh.default.hasResourceBundle("pl", "translation")).toBe(false);
    failing = false;
    await expect(fresh.loadLanguage("pl")).resolves.toBeUndefined();
    expect(fresh.default.hasResourceBundle("pl", "translation")).toBe(true);
  });

  it("loadLanguageWithin resolves on a failed load and on the cap", async () => {
    vi.doMock("dayjs/locale/pl", () => {
      throw new Error("chunk 404");
    });
    const fresh = await freshI18n();
    await expect(fresh.loadLanguageWithin("pl", 1000)).resolves.toBeUndefined();
    await expect(fresh.loadLanguageWithin("en", 1000)).resolves.toBeUndefined();

    vi.doUnmock("dayjs/locale/pl");
    vi.useFakeTimers();
    try {
      const never = new Promise(() => undefined);
      vi.doMock("dayjs/locale/pl", () => never);
      const capped = (await freshI18n()).loadLanguageWithin("pl", 50);
      await vi.advanceTimersByTimeAsync(60);
      await expect(capped).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("switchLanguage", () => {
  it("changes the active language and resolves keys in Polish", async () => {
    const fresh = await freshI18n();
    await fresh.switchLanguage("pl");
    expect(fresh.default.language).toBe("pl");
    expect(fresh.default.t("common.action.create")).toBe("Utwórz");
  });

  it("records the preference immediately, before the bundle has loaded", async () => {
    const fresh = await freshI18n();
    const pending = fresh.switchLanguage("pl");
    expect(localStorage.getItem("lettuce.lang")).toBe("pl");
    expect(fresh.targetLanguage()).toBe("pl");
    expect(fresh.default.language).toMatch(/^en/);
    await pending;
    expect(fresh.targetLanguage()).toBe("pl");
    expect(fresh.default.language).toBe("pl");
  });

  it("latest call wins: pl then en before the PL bundle arrives ends in en", async () => {
    const fresh = await freshI18n();
    const first = fresh.switchLanguage("pl");
    const second = fresh.switchLanguage("en");
    await Promise.all([first, second]);
    expect(fresh.default.language).toBe("en");
    expect(localStorage.getItem("lettuce.lang")).toBe("en");
    // The PL bundle did load meanwhile — it is registered but was never applied.
    expect(fresh.default.hasResourceBundle("pl", "translation")).toBe(true);
  });

  it("a superseded call does not fail even when its own load fails", async () => {
    vi.doMock("dayjs/locale/pl", () => {
      throw new Error("chunk 404");
    });
    const fresh = await freshI18n();
    const first = fresh.switchLanguage("pl");
    const second = fresh.switchLanguage("en");
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(fresh.default.language).toMatch(/^en/);
  });

  it("the newest call rejects when its bundle cannot load, and the UI stays put", async () => {
    vi.doMock("dayjs/locale/pl", () => {
      throw new Error("chunk 404");
    });
    const fresh = await freshI18n();
    await expect(fresh.switchLanguage("pl")).rejects.toThrow();
    expect(fresh.default.language).toMatch(/^en/);
    expect(fresh.targetLanguage()).toBe("en");
  });
});
