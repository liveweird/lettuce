import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ImpactLog from "./ImpactLog";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

const EMPTY_PAGE = { items: [], page: 1, pageSize: 20, total: 0 };

function renderScreen(route = "/impact-log", { manages = false } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mockFetch = vi.fn((url: string) => {
    const u = String(url);
    if (u.startsWith("/api/v1/teams?")) {
      // useIsManager probes for a team the caller manages.
      return Promise.resolve(
        jsonResponse(200, { items: [], page: 1, pageSize: 1, total: manages ? 1 : 0 }),
      );
    }
    if (u.startsWith("/api/v1/impact-log?")) {
      return Promise.resolve(jsonResponse(200, EMPTY_PAGE));
    }
    return Promise.resolve(jsonResponse(200, EMPTY_PAGE));
  });
  vi.stubGlobal("fetch", mockFetch);
  render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/impact-log" element={<ImpactLog />} />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  return mockFetch;
}

describe("ImpactLog page", () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("a non-manager sees only My journal, its hint, and the New entry button", async () => {
    renderScreen();

    expect(await screen.findByRole("heading", { name: "Impact log" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "My journal" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "My subordinates' journals" })).toBeNull();
    expect(await screen.findByText("No journal entries.")).toBeInTheDocument();
    const newEntry = screen.getByRole("link", { name: "New entry" });
    expect(newEntry).toHaveAttribute("href", "/impact-log/new?back=%2Fimpact-log");
  });

  test("a manager gets the managed tab; selecting it lists view=managed", async () => {
    const user = userEvent.setup();
    const mockFetch = renderScreen("/impact-log", { manages: true });

    const managedTab = await screen.findByRole("tab", { name: "My subordinates' journals" });
    await user.click(managedTab);

    await waitFor(() => {
      expect(
        mockFetch.mock.calls.some(([u]) => String(u).includes("view=managed")),
      ).toBe(true);
    });
    // The managed view is read-only, but the create entry point lives in the page header
    // (v3.3.0) — it always creates in the caller's OWN journal, whichever tab is open.
    expect(screen.getByRole("link", { name: "New entry" })).toHaveAttribute(
      "href",
      "/impact-log/new?back=%2Fimpact-log",
    );
  });

  test("?tab=managed is ignored for a non-manager (falls back to own)", async () => {
    const mockFetch = renderScreen("/impact-log?tab=managed");
    expect(await screen.findByText("No journal entries.")).toBeInTheDocument();
    expect(mockFetch.mock.calls.some(([u]) => String(u).includes("view=managed"))).toBe(false);
  });

  test("a disabled IMPACT_LOG flag redirects home", () => {
    localStorage.setItem("lettuce.auth.disabledFeatures", JSON.stringify(["IMPACT_LOG"]));
    renderScreen();
    expect(screen.getByTestId("probe")).toHaveTextContent("/");
    expect(screen.queryByRole("heading", { name: "Impact log" })).toBeNull();
  });
});
