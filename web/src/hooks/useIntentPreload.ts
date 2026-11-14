import { createContext, useCallback, useContext } from "react";

/** The handlers a navigation link spreads to warm its target page on user intent. */
type IntentHandlers = { onPointerEnter: () => void; onFocus: () => void };

/**
 * Warms the lazy page a path renders. The Shell provides it (App.tsx: `preloadRoute` over `appRoutes`, the one real route
 * table). It is injected rather than imported: the route table contains the Shell, the Shell the nav, so a nav that imported
 * the table would close an import cycle. Without a provider (page and nav tests) every handler is a no-op.
 */
export const IntentPreloadContext = createContext<((to: string) => void) | null>(null);

/**
 * Intent preload (v4.21.0): returns `intentPreload(to)` — `onPointerEnter`/`onFocus` handlers that load the lazy page chunk
 * `to` renders, so the first visit to a page usually skips the Suspense spinner. Safe to call per hover: `lazyPage` memoises
 * the load and `preloadRoute` never rejects.
 */
export function useIntentPreload(): (to: string) => IntentHandlers {
  const warmRoute = useContext(IntentPreloadContext);
  return useCallback(
    (to: string) => {
      const warm = () => warmRoute?.(to);
      return { onPointerEnter: warm, onFocus: warm };
    },
    [warmRoute],
  );
}
