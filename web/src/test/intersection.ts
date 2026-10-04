import { act } from "@testing-library/react";
import { vi } from "vitest";

/**
 * A manual IntersectionObserver for tests (happy-dom ships a no-op one that never reports anything):
 * install it with [installIntersectionObserver], then push an "is intersecting" entry through
 * Mantine's `useIntersection` with [fireIntersect]. Pair with `vi.unstubAllGlobals()` in afterEach.
 */
class MockIntersectionObserver {
  static readonly instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  observed: Element[] = [];
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.observed = [];
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

export function installIntersectionObserver() {
  MockIntersectionObserver.instances.length = 0;
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
}

/**
 * Report [isIntersecting] for every observed element (or only those [only] accepts). Returns how many fired.
 * `false` simulates scrolling back out.
 */
export function fireIntersect(only: (el: Element) => boolean = () => true, isIntersecting = true): number {
  const targets = MockIntersectionObserver.instances.filter((i) => i.observed.length > 0 && only(i.observed[0]!));
  act(() => {
    for (const observer of targets) {
      observer.callback(
        [{ isIntersecting, target: observer.observed[0] } as IntersectionObserverEntry],
        observer as unknown as IntersectionObserver,
      );
    }
  });
  return targets.length;
}
