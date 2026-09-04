import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { jsonResponse } from "../test/http";
import { useDashboardDrillDown } from "./useDashboardDrillDown";

type FetchMock = ReturnType<typeof vi.fn>;

const ALICE = { id: 10, name: "Alice Pool", email: "alice@example.com", roles: [] };
const BOB = { id: 11, name: "Bob Pool", email: "bob@example.com", roles: [] };

function usersPage(items: unknown[]) {
  return jsonResponse(200, { items, page: 1, pageSize: 100, total: items.length });
}

function isPoolUrl(url: unknown) {
  return String(url).startsWith("/api/v1/users?");
}

// The hook reads `:userId` from the route, so it renders inside a matching Route.
function renderDrillDown(route: string, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/users/:userId/goals" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  return renderHook(() => useDashboardDrillDown("goals"), { wrapper: Wrapper });
}

describe("useDashboardDrillDown displayName (the v3.5.0 identity rule)", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn((url: string) =>
      Promise.resolve(isPoolUrl(url) ? usersPage([ALICE, BOB]) : jsonResponse(404, {})),
    );
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.userId", "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders the URL's name as the pre-load hint, then the pool's name for the id — never the URL's", async () => {
    const { result } = renderDrillDown("/users/10/goals?name=Mallory&from=managers");

    // Before the pool arrives: the hint (so the heading never flashes "user #10").
    expect(result.current.displayName).toBe("Mallory");
    // The raw param stays available for the rebuilt links.
    expect(result.current.name).toBe("Mallory");
    expect(result.current.backTo).toBe("/users/10/goals?name=Mallory&from=managers");

    // Once the pool has loaded, the id wins over whatever the URL claimed.
    await waitFor(() => expect(result.current.displayName).toBe("Alice Pool"));
    expect(mockFetch.mock.calls.some(([u]) => isPoolUrl(u))).toBe(true);
  });

  test("without a hint the name is null until the pool resolves it", async () => {
    const { result } = renderDrillDown("/users/11/goals");

    expect(result.current.displayName).toBeNull();
    await waitFor(() => expect(result.current.displayName).toBe("Bob Pool"));
  });

  test("an id outside the loaded pool drops the hint to null (the page's user-# fallback)", async () => {
    const { result } = renderDrillDown("/users/99/goals?name=Mallory");

    expect(result.current.displayName).toBe("Mallory");
    await waitFor(() => expect(mockFetch.mock.calls.some(([u]) => isPoolUrl(u))).toBe(true));
    await waitFor(() => expect(result.current.displayName).toBeNull());
  });

  test("a pool that fails to load keeps the hint", async () => {
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse(500, {})));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderDrillDown("/users/10/goals?name=Mallory", queryClient);

    await waitFor(() => expect(queryClient.getQueryState(["users", "all"])?.status).toBe("error"));
    expect(result.current.displayName).toBe("Mallory");
  });

  test("an invalid id never fetches the pool", () => {
    const { result } = renderDrillDown("/users/abc/goals?name=Mallory");

    expect(result.current.idIsValid).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
