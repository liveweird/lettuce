import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/inter/index.css";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./index.css";
import i18n, { asSupportedLanguage, switchLanguage } from "./i18n";
import App, { appRoutes } from "./App.tsx";
import AppDatesProvider from "./components/AppDatesProvider";
import ErrorBoundary from "./components/ErrorBoundary";
import { shouldRetryQuery } from "./api/http";
import { getToken } from "./api/session";
import SessionCacheBoundary from "./api/SessionCacheBoundary";
import { preloadFirstRoute } from "./routePreload";
import { theme } from "./theme";
import { cssVariablesResolver } from "./themeVariables";

const queryClient = new QueryClient({
  // Never retry a 4xx; up to two retries for transient failures (see shouldRetryQuery).
  defaultOptions: { queries: { retry: shouldRetryQuery } },
});

// A redeploy invalidates the hashed lazy chunks — the first failed dynamic import reloads the
// page once to pick up the new index.html. Rate-limited via sessionStorage (at most one
// reload per minute) so a genuinely missing chunk can't loop; past that, the rejection falls
// through to the ErrorBoundary instead.
const CHUNK_RELOAD_KEY = "lettuce.chunkReloadedAt";
window.addEventListener("vite:preloadError", (event) => {
  const lastReload = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0);
  if (Date.now() - lastReload > 60_000) {
    event.preventDefault();
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    window.location.reload();
  }
});

function render() {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      {/* No <ColorSchemeScript> here: rendered inside the React tree it never executes, and
          public/color-scheme.js already stamps the scheme on <html> before the bundle loads. */}
      <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="auto">
        {/* The success-toast host (utils/toast.tsx is the only writer). Top-center on purpose:
            bottom-right would cover PaginationBar and form footers, top-right the header
            user-menu/bell cluster. Deliberately mounted here, not in App — tests never see it. */}
        <Notifications position="top-center" autoClose={2500} limit={3} />
        {/* Last-resort crash fallback; the navigation-resetting RouteErrorBoundary lives inside
            the Shell (App.tsx), so this one only catches crashes of the shell itself. */}
        <ErrorBoundary>
          <AppDatesProvider>
            <QueryClientProvider client={queryClient}>
              <SessionCacheBoundary>
                <App />
              </SessionCacheBoundary>
            </QueryClientProvider>
          </AppDatesProvider>
        </ErrorBoundary>
      </MantineProvider>
    </StrictMode>,
  );
}

// The first matched route's lazy page is loaded BEFORE the first render: a preloaded `lazyPage`
// renders synchronously, whereas a lazy page that suspends on its first render commits no sooner
// than 300 ms after its fallback (React's fallback throttle — perf findings W1/W7). The cap bounds
// a slow network: past it the app renders anyway and the route spinner takes over, exactly as
// before. A dead chunk after a redeploy still fires `vite:preloadError` (the listener above) —
// the preload rides Vite's `__vitePreload`.
const FIRST_PAINT_CAP_MS = 1000;
//
// The same wait covers the detected language's bundle (non-EN bundles are lazy — `i18n.ts`): a
// Polish user's first paint is already Polish, never an English flash. The detector can yield a
// region tag (`pl-PL`), hence the split.
// `allSettled`: one failing load must not release the render while the other is still in flight
// (both stay bounded by the cap); a failed preload falls back to the spinner path, a failed
// language load to the English fallback.
const ready = Promise.allSettled([
  preloadFirstRoute(appRoutes, window.location.pathname, getToken() !== null),
  switchLanguage(asSupportedLanguage(i18n.language.split("-")[0])),
]);
const cap = new Promise<void>((resolve) => setTimeout(resolve, FIRST_PAINT_CAP_MS));
void Promise.race([ready, cap]).then(render);
