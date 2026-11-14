import { useRef } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useScrollEdgeFallback } from "./useScrollEdgeFallback";

function Scroller({ enabled = true }: { enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollEdgeFallback(ref, enabled);
  return (
    <div ref={ref} data-testid="scroller">
      <div />
    </div>
  );
}

function geometry(el: HTMLElement, scrollLeft: number) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: 1000 });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: 400 });
  Object.defineProperty(el, "scrollLeft", { configurable: true, writable: true, value: scrollLeft });
}

afterEach(() => vi.unstubAllGlobals());

describe("useScrollEdgeFallback", () => {
  test("does nothing where the browser has scroll-state queries or scroll-driven animations", () => {
    vi.stubGlobal("CSS", { supports: (query: string) => query.startsWith("animation-timeline") });
    render(<Scroller />);
    const el = screen.getByTestId("scroller");
    fireEvent.scroll(el);
    expect(el).not.toHaveAttribute("data-more-start");
    expect(el).not.toHaveAttribute("data-more-end");
  });

  test("without either, marks which edges still have content beyond them as it scrolls", () => {
    vi.stubGlobal("CSS", { supports: () => false });
    render(<Scroller />);
    const el = screen.getByTestId("scroller");
    geometry(el, 0);
    fireEvent.scroll(el);
    expect(el).not.toHaveAttribute("data-more-start");
    expect(el).toHaveAttribute("data-more-end");

    el.scrollLeft = 250;
    fireEvent.scroll(el);
    expect(el).toHaveAttribute("data-more-start");
    expect(el).toHaveAttribute("data-more-end");

    el.scrollLeft = 600; // 1000 - 400: the far end
    fireEvent.scroll(el);
    expect(el).toHaveAttribute("data-more-start");
    expect(el).not.toHaveAttribute("data-more-end");
  });

  test("reads a right-to-left scroller (negative scrollLeft) by magnitude", () => {
    vi.stubGlobal("CSS", { supports: () => false });
    render(<Scroller />);
    const el = screen.getByTestId("scroller");
    geometry(el, -250);
    fireEvent.scroll(el);
    expect(el).toHaveAttribute("data-more-start");
    expect(el).toHaveAttribute("data-more-end");
  });

  test("a disabled hook leaves the element alone", () => {
    vi.stubGlobal("CSS", { supports: () => false });
    render(<Scroller enabled={false} />);
    const el = screen.getByTestId("scroller");
    geometry(el, 250);
    fireEvent.scroll(el);
    expect(el).not.toHaveAttribute("data-more-start");
  });
});
