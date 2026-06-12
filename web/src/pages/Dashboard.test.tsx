import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "../test/render";
import Dashboard from "./Dashboard";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Dashboard", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "USER");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders both lists and requests both views", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 })),
    );
    renderWithProviders(<Dashboard />);

    expect(screen.getByRole("heading", { name: "Users in my teams" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Users in teams I manage" })).toBeInTheDocument();

    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([url]) => String(url));
      expect(urls.some((url) => url.includes("/api/teams/members?view=member"))).toBe(true);
      expect(urls.some((url) => url.includes("/api/teams/members?view=managed"))).toBe(true);
    });

    expect(await screen.findByText("No teammates")).toBeInTheDocument();
    expect(screen.getByText("No team members")).toBeInTheDocument();
  });
});
