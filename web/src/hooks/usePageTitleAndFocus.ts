import { useEffect, useRef } from "react";

const MAIN_ID = "main-content";
/** How long a navigation's focus request waits for the new page's h1 before it is dropped. */
const FOCUS_REQUEST_TIMEOUT_MS = 3000;
/** Focus inside any of these is a user's (or the tour's) deliberate place — never steal it. */
const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]';

/** The main area's first h1 — the page's one title (v4.21.0). */
function pageHeading(main: HTMLElement): HTMLElement | null {
  return main.querySelector<HTMLElement>("h1");
}

/**
 * The Shell's page-chrome mechanism (WCAG 2.4.2 Page Titled + focus management on a client-side
 * route change), implemented ONCE here instead of per page:
 *
 * - `document.title` is `<the main area's h1> · <brand>` (just the brand while there is no h1) and
 *   follows the h1 as its text changes after data loads: a MutationObserver on `#main-content`
 *   (its callbacks are already batched per microtask, so the update runs directly — which also
 *   keeps it working in a background tab, where animation frames never fire), disconnected on
 *   unmount. A new `brand` (a language switch) updates it at once.
 * - On a PATHNAME change (not the initial load, not a search-param or tab change) focus moves to
 *   the new page's h1 as soon as it exists — it mounts after the lazy Suspense fallback — via
 *   `tabindex="-1"` and without scrolling (Back/Forward scroll restoration stays intact). Skipped
 *   when focus is already inside the main area (a page that autofocuses a field wins), inside the
 *   telemetry aside, or inside an overlay (a dialog, an alert dialog or the tour tooltip). A
 *   pending request is dropped at the next pathname change and after FOCUS_REQUEST_TIMEOUT_MS, so
 *   a heading that mounts much later (an error fallback, slow data) cannot pull focus. The only
 *   outline is index.css's `#main-content h1[tabindex="-1"]:focus-visible` (the theme ring);
 *   `:focus` draws none, so a mouse navigation shows nothing.
 */
export function usePageTitleAndFocus(pathname: string, brand: string): void {
  useEffect(() => {
    const main = document.getElementById(MAIN_ID);
    if (!main) return;
    const update = () => {
      const text = pageHeading(main)?.textContent?.trim();
      const next = text ? `${text} · ${brand}` : brand;
      if (document.title !== next) document.title = next;
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(main, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [brand]);

  // Compared rather than "skip the first run": StrictMode's double-invoked mount effect must not
  // count as a navigation.
  const previousPathname = useRef(pathname);
  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    const main = document.getElementById(MAIN_ID);
    if (!main) return;

    const tryFocus = (): boolean => {
      const heading = pageHeading(main);
      if (!heading) return false;
      const active = document.activeElement;
      const focusAlreadyPlaced =
        active instanceof HTMLElement &&
        active !== main &&
        (main.contains(active) || active.closest(`aside, ${OVERLAY_SELECTOR}`) != null);
      if (!focusAlreadyPlaced) {
        if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
      }
      return true;
    };

    if (tryFocus()) return;
    function stop() {
      observer.disconnect();
      clearTimeout(timer);
    }
    const observer = new MutationObserver(() => {
      if (tryFocus()) stop();
    });
    const timer = setTimeout(stop, FOCUS_REQUEST_TIMEOUT_MS);
    observer.observe(main, { childList: true, subtree: true });
    return stop;
  }, [pathname]);
}
