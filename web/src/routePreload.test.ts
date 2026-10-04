import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { RouteObject } from "react-router-dom";
import { appRoutes } from "./App";
import { preloadFirstRoute } from "./routePreload";

type Preloadable = { preload: () => Promise<void> };

/** The lazy page component a route renders (unwrapping guard wrappers), found through the real route tree. */
function pageAt(path: string, routes: RouteObject[] = appRoutes): Preloadable | undefined {
  for (const r of routes) {
    if (r.path === path || (path === "" && r.index)) {
      let el = r.element as ReactElement<{ children?: ReactElement }> | undefined;
      while (el && typeof (el.type as Partial<Preloadable>).preload !== "function") {
        el = el.props.children as ReactElement<{ children?: ReactElement }> | undefined;
      }
      if (el) return el.type as unknown as Preloadable;
    }
    const nested = r.children ? pageAt(path, r.children) : undefined;
    if (nested) return nested;
  }
  return undefined;
}

function spyOn(path: string) {
  const page = pageAt(path);
  if (!page) throw new Error(`no lazy page at "${path}"`);
  return vi.spyOn(page, "preload").mockResolvedValue(undefined);
}

afterEach(() => vi.restoreAllMocks());

describe("preloadFirstRoute", () => {
  it("preloads the dashboard for / when signed in", async () => {
    const dashboard = spyOn("");
    const login = spyOn("/login");
    await preloadFirstRoute(appRoutes, "/", true);
    expect(dashboard).toHaveBeenCalledTimes(1);
    expect(login).not.toHaveBeenCalled();
  });

  it("preloads Login for /login when signed out", async () => {
    const login = spyOn("/login");
    await preloadFirstRoute(appRoutes, "/login", false);
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("preloads a parameterised route", async () => {
    const editUser = spyOn("users/:id/edit");
    await preloadFirstRoute(appRoutes, "/users/5/edit", true);
    expect(editUser).toHaveBeenCalledTimes(1);
  });

  it("preloads NotFound for an unmatched authenticated path", async () => {
    const notFound = spyOn("*");
    await preloadFirstRoute(appRoutes, "/nope", true);
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("preloads Login (not the protected page) for a protected path when signed out", async () => {
    const feedback = spyOn("feedback");
    const login = spyOn("/login");
    await preloadFirstRoute(appRoutes, "/feedback", false);
    expect(login).toHaveBeenCalledTimes(1);
    expect(feedback).not.toHaveBeenCalled();
  });

  it("preloads the dashboard for the guest-only /login when already signed in", async () => {
    const dashboard = spyOn("");
    const login = spyOn("/login");
    await preloadFirstRoute(appRoutes, "/login", true);
    expect(dashboard).toHaveBeenCalledTimes(1);
    expect(login).not.toHaveBeenCalled();
  });

  it("resolves when no route matches", async () => {
    await expect(preloadFirstRoute([], "/anything", true)).resolves.toBeUndefined();
  });
});
