import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SuccessionPlans from "./SuccessionPlans";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

const EMPTY_PAGE = { items: [], page: 1, pageSize: 20, total: 0 };

function renderScreen(route = "/succession", { manages = false } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mockFetch = vi.fn((url: string) => {
    const u = String(url);
    if (u.startsWith("/api/v1/teams?")) {
      // useIsManager probes for a team the caller manages.
      return Promise.resolve(
        jsonResponse(200, { items: [], page: 1, pageSize: 1, total: manages ? 1 : 0 }),
      );
    }
    return Promise.resolve(jsonResponse(200, EMPTY_PAGE));
  });
  vi.stubGlobal("fetch", mockFetch);
  render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/succession" element={<SuccessionPlans />} />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  return mockFetch;
}

describe("SuccessionPlans page", () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("a non-manager direct visit gets the empty own tab and no create button (nav hides the leaf)", async () => {
    renderScreen();

    expect(await screen.findByRole("heading", { name: "Succession plans" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "My plans" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "My subordinates' plans" })).toBeNull();
    expect(await screen.findByText("No succession plans")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New plan" })).toBeNull();
  });

  test("a manager gets the create button and the team tab; selecting it lists view=team", async () => {
    const user = userEvent.setup();
    const mockFetch = renderScreen("/succession", { manages: true });

    const newPlan = await screen.findByRole("link", { name: "New plan" });
    expect(newPlan).toHaveAttribute("href", "/succession/new?back=%2Fsuccession");

    const teamTab = await screen.findByRole("tab", { name: "My subordinates' plans" });
    await user.click(teamTab);
    await waitFor(() => {
      expect(
        mockFetch.mock.calls.some(([url]) => String(url).includes("view=team")),
      ).toBe(true);
    });
  });

  test("a disabled SUCCESSION_PLANS feature bounces to the dashboard", async () => {
    localStorage.setItem("lettuce.auth.disabledFeatures", JSON.stringify(["SUCCESSION_PLANS"]));
    renderScreen();
    expect(await screen.findByTestId("probe")).toHaveTextContent("/");
  });
});
