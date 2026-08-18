import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Link, Outlet, Route, Routes } from "react-router-dom";
import { renderWithProviders, screen } from "../test/render";
import userEvent from "@testing-library/user-event";
import ErrorBoundary, { RouteErrorBoundary } from "./ErrorBoundary";

function Bomb(): ReactElement {
  throw new Error("render crash");
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // React logs every boundary-caught error — keep the test output quiet.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("renders its children when nothing throws", () => {
    renderWithProviders(
      <ErrorBoundary>
        <div>healthy content</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("healthy content")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });

  test("a render-time throw swaps in the crash fallback with a Reload button", async () => {
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    renderWithProviders(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalled();
  });

  test("RouteErrorBoundary recovers when the user navigates away from the crashed page", async () => {
    renderWithProviders(
      <Routes>
        <Route
          element={
            <>
              {/* The nav lives OUTSIDE the boundary — like the AppShell header/navbar. */}
              <Link to="/b">go somewhere safe</Link>
              <RouteErrorBoundary>
                <Outlet />
              </RouteErrorBoundary>
            </>
          }
        >
          <Route path="/a" element={<Bomb />} />
          <Route path="/b" element={<div>safe page</div>} />
        </Route>
      </Routes>,
      { route: "/a" },
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    await userEvent.click(screen.getByText("go somewhere safe"));

    // The location key remounted the boundary — no stale fallback, the new page renders.
    expect(await screen.findByText("safe page")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });
});
