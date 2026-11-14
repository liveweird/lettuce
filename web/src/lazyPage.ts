import { createElement, lazy, useState, type ComponentType } from "react";

type Loader<P> = () => Promise<{ default: ComponentType<P> }>;

const resolved = new Map<Loader<never>, ComponentType<never>>();

/**
 * `React.lazy` whose module can be PRELOADED (`Page.preload()`): once loaded it renders
 * synchronously — no Suspense fallback, hence no fallback throttle (react-dom commits a retry
 * no sooner than 300 ms after the fallback it replaces, even when the module is already
 * loaded). `main.tsx` preloads the first matched route before the first render
 * (`routePreload.ts`); navigations were never affected (React Router wraps them in a
 * transition). `preloadRoute` (routePreload.ts) also warms a page on navigation-link hover/focus.
 * Without a preload it behaves exactly like `lazy`.
 */
export default function lazyPage<P extends object>(loader: Loader<P>) {
  const Lazy = lazy(loader);
  function Page(props: P) {
    // Pinned at mount: a re-render after the module resolved must not swap the element type
    // (that would remount the whole page subtree and lose its state).
    const [Component] = useState(() => (resolved.get(loader as Loader<never>) as ComponentType<P> | undefined) ?? Lazy);
    return createElement(Component, props);
  }
  // Memoised: hover/focus intent preloads (routePreload.ts) call this repeatedly, and a chunk
  // must load once. A rejection clears the memo so a later attempt (the real navigation, or the
  // next hover) retries; the loaded case never re-enters the loader at all.
  let pending: Promise<void> | undefined;
  Page.preload = () => {
    if (resolved.has(loader as Loader<never>)) return Promise.resolve();
    pending ??= loader().then(
      (m) => {
        resolved.set(loader as Loader<never>, m.default as ComponentType<never>);
      },
      (error: unknown) => {
        pending = undefined;
        throw error;
      },
    );
    return pending;
  };
  return Page;
}
