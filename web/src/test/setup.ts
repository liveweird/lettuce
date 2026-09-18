import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { DEFAULT_THEME } from "@mantine/core";
import i18n from "../i18n";

// Deterministic English in tests (the global i18n instance is shared by every test, including the
// many that render with their own inline providers — no per-test I18nextProvider needed).
void i18n.changeLanguage("en");

if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  const localStorageMock: Storage = {
    get length() {
      return store.size;
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageMock,
    configurable: true,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      value: localStorageMock,
      configurable: true,
    });
  }
}

// Force `prefers-reduced-motion: reduce` for every test, unconditionally — this is what makes
// Mantine's Transition/Modal/Drawer etc. render synchronously (duration 0) in tests instead of
// scheduling an rAF -> rAF -> setTimeout(duration) chain via useTransition's useDidUpdate. happy-dom
// (unlike older jsdom) ships its own `window.matchMedia`, so the old "only shim if missing" guard
// below never installed and reduced motion stayed false; a flip in a file's last test could then
// have its scheduled timer fire after the test environment tore down, surfacing as an unhandled
// `ReferenceError: window is not defined` from @mantine/core's use-transition.mjs (seen in CI runs
// 35160937596 and 34292137664, in CreateSuccessionPlan.test.tsx / CreateFeedback.test.tsx). Forcing
// reduced motion also mirrors a real user with that OS/browser preference — `theme.ts` already sets
// `respectReducedMotion: true`, so this is exercising the same code path Mantine ships for them.
// Every other query still resolves through the original matchMedia (or a no-match stub when the
// environment has none), so unrelated media-query logic is unaffected.
const originalMatchMedia = typeof window !== "undefined" ? window.matchMedia?.bind(window) : undefined;

function makeMediaQueryList(query: string, matches: boolean): MediaQueryList {
  return {
    matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  } as MediaQueryList;
}

if (typeof window !== "undefined") {
  window.matchMedia = (query: string) => {
    if (query.includes("prefers-reduced-motion: reduce")) {
      return makeMediaQueryList(query, true);
    }
    return originalMatchMedia ? originalMatchMedia(query) : makeMediaQueryList(query, false);
  };
}

// Forcing the media query alone is not enough: Mantine's Transition only honors reduced motion
// when `theme.respectReducedMotion` is true, and that defaults to false on Mantine's own
// DEFAULT_THEME — `web/src/theme.ts` sets it explicitly, but a good number of test files render
// through a file-local, bare `<MantineProvider env="test">` (no `theme={theme}`), which resolves
// straight to Mantine's shared, mutable `DEFAULT_THEME` object. Flip it once, globally, before any
// test renders, so every provider — themed or bare — gets the zero-duration transition path.
DEFAULT_THEME.respectReducedMotion = true;

// happy-dom does not implement the FontFaceSet API. Mantine's autosize Textarea
// subscribes to `document.fonts` "loadingdone" events on mount; without this shim
// it throws "Cannot read properties of undefined (reading 'addEventListener')".
if (typeof document !== "undefined" && !document.fonts) {
  Object.defineProperty(document, "fonts", {
    value: {
      addEventListener: () => {},
      removeEventListener: () => {},
      ready: Promise.resolve(),
    },
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});
