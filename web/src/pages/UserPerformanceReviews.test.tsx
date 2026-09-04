import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import UserPerformanceReviews from "./UserPerformanceReviews";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";
const ROLES_KEY = "lettuce.auth.roles";

type FetchMock = ReturnType<typeof vi.fn>;

function renderPage(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/users/:userId/performance-reviews" element={<UserPerformanceReviews />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("UserPerformanceReviews page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(USER_ID_KEY, "7");
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/api/v1/review-periods")) {
        return Promise.resolve(jsonResponse(200, { items: [] }));
      }
      // The org-wide user pool the heading resolves the person's name from (v3.5.0).
      if (u.startsWith("/api/v1/users?")) {
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              { id: 8, name: "Sub Ordinate", email: "sub@example.com", roles: [] },
              { id: 9, name: "Mona Manager", email: "mona@example.com", roles: [] },
            ],
            page: 1,
            pageSize: 100,
            total: 2,
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("subordinates origin: managed view widened to the chain, plus the New-review footer", async () => {
    renderPage("/users/8/performance-reviews?name=Sub+Ordinate&from=subordinates");

    expect(await screen.findByText("Performance reviews of Sub Ordinate")).toBeInTheDocument();
    const listCall = mockFetch.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes("/api/v1/performance-reviews?"));
    expect(listCall).toContain("view=managed");
    expect(listCall).toContain("subordinateId=8");
    expect(listCall).toContain("includeIndirect=true");
    const newReview = screen.getByRole("link", { name: "New review" });
    expect(newReview.getAttribute("href")).toContain("/performance-reviews/new?subordinateId=8");
  });

  test("managers origin: the clicked manager's published reviews of the caller, no create", async () => {
    renderPage("/users/9/performance-reviews?name=Mona+Manager&from=managers");

    expect(await screen.findByText("Performance reviews from Mona Manager")).toBeInTheDocument();
    const listCall = mockFetch.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes("/api/v1/performance-reviews?"));
    expect(listCall).toContain("view=own");
    expect(listCall).toContain("managerId=9");
    expect(screen.queryByRole("link", { name: "New review" })).toBeNull();
  });

  test("audit mode (HR caller): the read-only user view", async () => {
    localStorage.setItem(ROLES_KEY, JSON.stringify(["HR"]));
    renderPage("/users/8/performance-reviews?name=Sub+Ordinate&from=details&mode=audit");

    expect(await screen.findByText("All performance reviews of Sub Ordinate")).toBeInTheDocument();
    const listCall = mockFetch.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes("/api/v1/performance-reviews?"));
    expect(listCall).toContain("view=user");
    expect(listCall).toContain("userId=8");
    expect(screen.queryByRole("link", { name: "New review" })).toBeNull();
  });

  test("a non-auditor's mode=audit silently falls back to the normal view", async () => {
    renderPage("/users/8/performance-reviews?name=Sub+Ordinate&from=subordinates&mode=audit");

    expect(await screen.findByText("Performance reviews of Sub Ordinate")).toBeInTheDocument();
    const listCall = mockFetch.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes("/api/v1/performance-reviews?"));
    expect(listCall).toContain("view=managed");
  });
});
