import { useEffect, useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { usePageTitleAndFocus } from "./usePageTitleAndFocus";

function LatePage() {
  // The title arrives after "data loads", like a detail page's name.
  const [name, setName] = useState("Loading");
  useEffect(() => {
    const timer = setTimeout(() => setName("Grace Hopper"), 20);
    return () => clearTimeout(timer);
  }, []);
  return <h1>{name}</h1>;
}

function LateHeadingPage() {
  // Mounts without an h1 (the lazy chunk / data gate), then renders it.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 20);
    return () => clearTimeout(timer);
  }, []);
  return ready ? <h1>Late heading</h1> : <p>Loading</p>;
}

function VeryLateHeadingPage() {
  // Past the focus request's time box.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 5000);
    return () => clearTimeout(timer);
  }, []);
  return ready ? <h1>Very late heading</h1> : <p>Loading</p>;
}

function GoFromDialog() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/b")}>
      Go from dialog
    </button>
  );
}

function Harness({ brand }: { brand: string }) {
  const { pathname } = useLocation();
  usePageTitleAndFocus(pathname, brand);
  return (
    <>
      <nav>
        <Link to="/a">to A</Link>
        <Link to="/b">to B</Link>
        <Link to="/a?tab=2">A tab 2</Link>
        <Link to="/field">to field</Link>
        <Link to="/late">to late</Link>
        <Link to="/late-heading">to late heading</Link>
        <Link to="/plain">to plain</Link>
        <Link to="/very-late">to very late</Link>
      </nav>
      <main id="main-content" tabIndex={-1}>
        <Routes>
          <Route path="/a" element={<h1>Page A</h1>} />
          <Route path="/b" element={<h1>Page B</h1>} />
          <Route path="/late" element={<LatePage />} />
          <Route path="/late-heading" element={<LateHeadingPage />} />
          <Route path="/very-late" element={<VeryLateHeadingPage />} />
          <Route path="/plain" element={<p>No title here</p>} />
          <Route
            path="/field"
            element={
              <>
                <h1>Form page</h1>
                <input aria-label="Name" autoFocus />
              </>
            }
          />
        </Routes>
      </main>
      <div role="dialog" aria-label="Overlay">
        <GoFromDialog />
      </div>
    </>
  );
}

function renderAt(route: string, brand = "Lettuce") {
  const view = render(
    <MemoryRouter initialEntries={[route]}>
      <Harness brand={brand} />
    </MemoryRouter>,
  );
  return {
    ...view,
    setBrand: (next: string) =>
      view.rerender(
        <MemoryRouter initialEntries={[route]}>
          <Harness brand={next} />
        </MemoryRouter>,
      ),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("usePageTitleAndFocus", () => {
  test("titles the document from the main area's h1, without moving focus on the first render", () => {
    renderAt("/a");
    expect(document.title).toBe("Page A · Lettuce");
    expect(document.body).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Page A" })).not.toHaveAttribute("tabindex");
  });

  test("follows the h1 when its text changes after the data loads", async () => {
    const user = userEvent.setup();
    renderAt("/a");
    await user.click(screen.getByRole("link", { name: "to late" }));
    await waitFor(() => expect(document.title).toBe("Grace Hopper · Lettuce"));
  });

  test("falls back to the bare brand while the main area has no h1", async () => {
    const user = userEvent.setup();
    renderAt("/a");
    await user.click(screen.getByRole("link", { name: "to plain" }));
    await waitFor(() => expect(document.title).toBe("Lettuce"));
  });

  test("a new brand (a language switch) updates the title at once", () => {
    const view = renderAt("/a");
    view.setBrand("Sałata");
    expect(document.title).toBe("Page A · Sałata");
  });

  test("moves focus to the new page's h1 after a pathname change", async () => {
    const user = userEvent.setup();
    renderAt("/a");
    await user.click(screen.getByRole("link", { name: "to B" }));
    const heading = await screen.findByRole("heading", { name: "Page B" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveAttribute("tabindex", "-1");
  });

  test("waits for an h1 that mounts later (the lazy chunk) and focuses it then", async () => {
    const user = userEvent.setup();
    renderAt("/a");
    await user.click(screen.getByRole("link", { name: "to late heading" }));
    const heading = await screen.findByRole("heading", { name: "Late heading" });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  test("does not move focus for a search-param change on the same path", async () => {
    const user = userEvent.setup();
    renderAt("/a");
    const link = screen.getByRole("link", { name: "A tab 2" });
    await user.click(link);
    expect(link).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Page A" })).not.toHaveFocus();
  });

  test("leaves focus alone when a field in the main area already has it", async () => {
    const user = userEvent.setup();
    renderAt("/a");
    await user.click(screen.getByRole("link", { name: "to field" }));
    const field = await screen.findByRole("textbox", { name: "Name" });
    await waitFor(() => expect(field).toHaveFocus());
    expect(screen.getByRole("heading", { name: "Form page" })).not.toHaveFocus();
  });

  test("a request still pending when the path changes again is dropped", async () => {
    const user = userEvent.setup();
    renderAt("/a");
    await user.click(screen.getByRole("link", { name: "to plain" }));
    await user.click(screen.getByRole("link", { name: "to B" }));
    const heading = await screen.findByRole("heading", { name: "Page B" });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  test("updates the title from the observer directly, with no animation frame involved", async () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const user = userEvent.setup();
    renderAt("/a");
    await user.click(screen.getByRole("link", { name: "to B" }));
    await waitFor(() => expect(document.title).toBe("Page B · Lettuce"));
    expect(raf).not.toHaveBeenCalled();
  });

  test("does not steal focus from a dialog that holds it", async () => {
    const user = userEvent.setup();
    renderAt("/a");
    const button = screen.getByRole("button", { name: "Go from dialog" });
    await user.click(button);
    const heading = await screen.findByRole("heading", { name: "Page B" });
    await waitFor(() => expect(document.title).toBe("Page B · Lettuce"));
    expect(button).toHaveFocus();
    expect(heading).not.toHaveFocus();
  });

  test("passes preventScroll when it focuses the heading", async () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const user = userEvent.setup();
    renderAt("/a");
    await user.click(screen.getByRole("link", { name: "to B" }));
    const heading = await screen.findByRole("heading", { name: "Page B" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(focus.mock.calls.some((args) => args[0]?.preventScroll === true)).toBe(true);
  });

  test("drops the request when the h1 appears after the time box", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderAt("/a");
    await user.click(screen.getByRole("link", { name: "to very late" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    const heading = screen.getByRole("heading", { name: "Very late heading" });
    expect(heading).not.toHaveFocus();
    expect(document.title).toBe("Very late heading · Lettuce");
  });
});
