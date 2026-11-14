import { useEffect, type RefObject } from "react";

// The last-resort fallback of the scroll-edge shadows (components/scrollEdges.module.css): where a
// browser has neither scroll-state container queries nor scroll-driven animations, the shadows
// are shown from `data-more-start` / `data-more-end` on the scroller. Everywhere else this hook
// does nothing at all — no listener, no observer.
function needsFallback(): boolean {
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return false;
  return !CSS.supports("container-type: scroll-state") && !CSS.supports("animation-timeline: scroll()");
}

// A scroll listener rather than the guide's IntersectionObserver: a table is its scroller's only
// child, so "first/last child fully visible" cannot tell the two edges apart (sentinel elements
// would have to be injected into the table's flex track). The attribute contract is the same.
export function useScrollEdgeFallback(ref: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || !needsFallback()) return undefined;
    const update = () => {
      // scrollLeft is negative in right-to-left scrollers: compare magnitudes.
      const position = Math.abs(el.scrollLeft);
      const furthest = el.scrollWidth - el.clientWidth;
      el.toggleAttribute("data-more-start", position > 1);
      el.toggleAttribute("data-more-end", furthest - position > 1);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      observer?.disconnect();
      el.removeAttribute("data-more-start");
      el.removeAttribute("data-more-end");
    };
  }, [ref, enabled]);
}
