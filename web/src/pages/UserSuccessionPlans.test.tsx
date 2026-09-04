import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import UserSuccessionPlans from "./UserSuccessionPlans";
import { theme } from "../theme";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

function renderScreen(route: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mockFetch = vi.fn((url: string) =>
    Promise.resolve(
      // The org-wide user pool the heading resolves the person's name from (v3.5.0).
      String(url).startsWith("/api/v1/users?")
        ? jsonResponse(200, {
            items: [{ id: 8, name: "Sam Seat", email: "sam@example.com", roles: [] }],
            page: 1,
            pageSize: 100,
            total: 1,
          })
        : jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }),
    ),
  );
  vi.stubGlobal("fetch", mockFetch);
  render(
    <MantineProvider env="test" theme={theme}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/users/:userId/succession" element={<UserSuccessionPlans />} />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  return mockFetch;
}

describe("UserSuccessionPlans page", () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("an HR auditor's ?mode=audit visit lists view=user for the target", async () => {
    localStorage.setItem(ROLE_KEY, JSON.stringify(["HR"]));
    const mockFetch = renderScreen("/users/8/succession?name=Sam%20Seat&from=details&mode=audit");

    expect(
      await screen.findByRole("heading", { name: "Succession plans of Sam Seat (audit)" }),
    ).toBeInTheDocument();
    expect(
      mockFetch.mock.calls.some(
        ([url]) => String(url).includes("view=user") && String(url).includes("userId=8"),
      ),
    ).toBe(true);
  });

  test("a non-auditor (mode=audit ignored) bounces to the Succession page", async () => {
    localStorage.setItem(ROLE_KEY, "[]");
    renderScreen("/users/8/succession?name=Sam%20Seat&from=details&mode=audit");
    expect(await screen.findByTestId("probe")).toHaveTextContent("/succession");
  });
});
