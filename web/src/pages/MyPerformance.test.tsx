import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MyPerformance from "./MyPerformance";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";

describe("MyPerformance page", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(USER_ID_KEY, "8");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders the own view — the server serves published reviews only", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/api/v1/review-periods")) {
        return Promise.resolve(jsonResponse(200, { items: [] }));
      }
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    });
    render(
      <MantineProvider env="test">
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter>
            <MyPerformance />
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );

    expect(await screen.findByText("My performance")).toBeInTheDocument();
    expect(
      screen.getByText("The performance reviews your manager published about you, by period."),
    ).toBeInTheDocument();
    expect(await screen.findByText("No performance reviews")).toBeInTheDocument();
    const listCall = mockFetch.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes("/api/v1/performance-reviews?"));
    expect(listCall).toContain("view=own");
  });
});
