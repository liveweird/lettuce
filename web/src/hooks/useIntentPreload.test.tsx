import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, type RouteObject } from "react-router-dom";
import { IntentPreloadContext, useIntentPreload } from "./useIntentPreload";
import { preloadRoute } from "../routePreload";

function page(preload: () => Promise<void>) {
  const Page = () => null;
  Page.preload = preload;
  return Page;
}

function Nav() {
  const intentPreload = useIntentPreload();
  return (
    <nav>
      <Link to="/goals" {...intentPreload("/goals")}>
        Goals
      </Link>
      <Link to="/missing" {...intentPreload("/nowhere/at/all")}>
        Missing
      </Link>
    </nav>
  );
}

// The Shell's provider in miniature: `preloadRoute` over a route table.
function renderNav(goalsPreload: () => Promise<void>) {
  const Goals = page(goalsPreload);
  const routes: RouteObject[] = [{ path: "/goals", element: <Goals /> }];
  render(
    <MemoryRouter>
      <IntentPreloadContext.Provider value={(to) => void preloadRoute(routes, to)}>
        <Nav />
      </IntentPreloadContext.Provider>
    </MemoryRouter>,
  );
}

describe("useIntentPreload", () => {
  it("preloads the matched page on hover and on focus", async () => {
    const preload = vi.fn().mockResolvedValue(undefined);
    renderNav(preload);
    await userEvent.hover(screen.getByRole("link", { name: "Goals" }));
    expect(preload).toHaveBeenCalledTimes(1);
    fireEvent.focus(screen.getByRole("link", { name: "Goals" }));
    expect(preload).toHaveBeenCalledTimes(2); // memoisation lives in lazyPage, not here
  });

  it("is a no-op for a path no route matches", async () => {
    const preload = vi.fn().mockResolvedValue(undefined);
    renderNav(preload);
    await userEvent.hover(screen.getByRole("link", { name: "Missing" }));
    expect(preload).not.toHaveBeenCalled();
  });

  it("swallows a rejected preload", async () => {
    // An escaped rejection would surface as a vitest "Unhandled Rejection" error and fail the run.
    const preload = vi.fn().mockRejectedValue(new Error("chunk 404"));
    renderNav(preload);
    await userEvent.hover(screen.getByRole("link", { name: "Goals" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(preload).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a provider", async () => {
    render(
      <MemoryRouter>
        <Nav />
      </MemoryRouter>,
    );
    await userEvent.hover(screen.getByRole("link", { name: "Goals" }));
    expect(screen.getByRole("link", { name: "Goals" })).toBeInTheDocument();
  });
});
