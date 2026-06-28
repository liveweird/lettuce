import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
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

  test("shows three tabs and lazily loads each tab's view", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 })),
    );
    const user = userEvent.setup();
    renderWithProviders(<Dashboard />);

    // Page heading plus the three tabs (the section names are now tabs, not headings).
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "My managers" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "My peers" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "My subordinates" })).toBeInTheDocument();

    // The tabs carry the data-tour anchors the guided tour targets for its subsection steps.
    expect(screen.getByRole("tab", { name: "My managers" })).toHaveAttribute(
      "data-tour",
      "dashboard-managers",
    );
    expect(screen.getByRole("tab", { name: "My peers" })).toHaveAttribute(
      "data-tour",
      "dashboard-peers",
    );
    expect(screen.getByRole("tab", { name: "My subordinates" })).toHaveAttribute(
      "data-tour",
      "dashboard-subordinates",
    );

    // The default (managers) tab loads its view on mount.
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([url]) => String(url));
      expect(urls.some((url) => url.includes("/api/teams/members?view=managers"))).toBe(true);
    });
    expect(await screen.findByText("No managers")).toBeInTheDocument();

    // Switching tabs loads the corresponding view (panels are not kept mounted).
    await user.click(screen.getByRole("tab", { name: "My peers" }));
    expect(await screen.findByText("No teammates")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "My subordinates" }));
    expect(await screen.findByText("No team members")).toBeInTheDocument();

    const urls = mockFetch.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes("/api/teams/members?view=member"))).toBe(true);
    expect(urls.some((url) => url.includes("/api/teams/members?view=managed"))).toBe(true);
  });

  test("honors ?tab=peers from the URL", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 })),
    );
    renderWithProviders(<Dashboard />, { route: "/?tab=peers" });

    expect(await screen.findByText("No teammates")).toBeInTheDocument();
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([url]) => String(url));
      expect(urls.some((url) => url.includes("/api/teams/members?view=member"))).toBe(true);
    });
  });

  test("honors ?tab=subordinates from the URL", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 })),
    );
    renderWithProviders(<Dashboard />, { route: "/?tab=subordinates" });

    expect(await screen.findByText("No team members")).toBeInTheDocument();
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([url]) => String(url));
      expect(urls.some((url) => url.includes("/api/teams/members?view=managed"))).toBe(true);
    });
  });

  test("falls back to the managers tab for an unknown ?tab= value", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 })),
    );
    renderWithProviders(<Dashboard />, { route: "/?tab=bogus" });

    // Unknown tab → default managers view loads, not peers/subordinates.
    expect(await screen.findByText("No managers")).toBeInTheDocument();
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([url]) => String(url));
      expect(urls.some((url) => url.includes("/api/teams/members?view=managers"))).toBe(true);
    });
  });
});
