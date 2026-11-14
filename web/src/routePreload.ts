import { isValidElement, type ReactNode } from "react";
import { matchRoutes, type RouteObject } from "react-router-dom";
import { RedirectIfAuthed, RequireAuth } from "./auth";

type Preloadable = { preload: () => Promise<void> };

function isPreloadable(type: unknown): type is Preloadable {
  return typeof type === "function" && typeof (type as Partial<Preloadable>).preload === "function";
}

/** The element type of `node` plus its single-child wrapper chain (e.g. `<RedirectIfAuthed><Login /></…>`). */
function elementTypes(node: ReactNode): unknown[] {
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node.type, ...elementTypes(node.props.children)];
}

/**
 * Preloads the lazy page the FIRST render will show (see `lazyPage.ts` — a preloaded page renders
 * without a Suspense fallback, so the first screen skips React's 300 ms fallback throttle).
 * Resolves with the page's chunk loaded. A signed-out visitor on a protected path gets the
 * `/login` page (what `RequireAuth` redirects to) and a signed-in visitor on a guest-only path
 * (`/login`, `/reset-password`) gets `/` (what `RedirectIfAuthed` redirects to).
 */
export function preloadFirstRoute(routes: RouteObject[], pathname: string, authenticated: boolean): Promise<void> {
  const matches = matchRoutes(routes, pathname) ?? [];
  const types = matches.flatMap((m) => elementTypes(m.route.element));
  if (!authenticated && types.includes(RequireAuth)) {
    return preloadFirstRoute(routes, "/login", false);
  }
  if (authenticated && types.includes(RedirectIfAuthed)) {
    return preloadFirstRoute(routes, "/", true);
  }
  return Promise.all(types.filter(isPreloadable).map((t) => t.preload())).then(() => undefined);
}

/**
 * Warms the lazy page(s) `pathname` would render — the intent preload behind navigation-link
 * hover/focus (`hooks/useIntentPreload.ts`). Same route→page matching as `preloadFirstRoute`
 * (no auth redirect handling: the nav only renders for a signed-in user), idempotent through
 * `lazyPage`'s memoised `preload()`, an unknown path is a no-op, and it NEVER rejects — a failed
 * chunk load is the real navigation's problem (it retries, and `vite:preloadError` stays the authority).
 */
export function preloadRoute(routes: RouteObject[], pathname: string): Promise<void> {
  const matches = matchRoutes(routes, pathname) ?? [];
  const pages = matches.flatMap((m) => elementTypes(m.route.element)).filter(isPreloadable);
  return Promise.allSettled(pages.map((t) => t.preload())).then(() => undefined);
}
