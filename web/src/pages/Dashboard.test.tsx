import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { renderWithProviders, screen, waitFor } from "../test/render";
import Dashboard from "./Dashboard";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;


describe("Dashboard", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("shows four tabs and lazily loads each tab's view", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 })),
    );
    const user = userEvent.setup();
    renderWithProviders(<Dashboard />);

    // Page heading plus the four tabs (the section names are now tabs, not headings).
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "My managers" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "My peers" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "My subordinates" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "My teams" })).toBeInTheDocument();

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
    expect(screen.getByRole("tab", { name: "My teams" })).toHaveAttribute(
      "data-tour",
      "dashboard-myTeams",
    );

    // The default (managers) tab loads its view on mount.
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([url]) => String(url));
      expect(urls.some((url) => url.includes("/api/v1/teams/members?view=managers"))).toBe(true);
    });
    expect(await screen.findByText("No managers")).toBeInTheDocument();

    // Switching tabs loads the corresponding view (panels are not kept mounted).
    await user.click(screen.getByRole("tab", { name: "My peers" }));
    expect(await screen.findByText("No teammates")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "My subordinates" }));
    expect(await screen.findByText("No team members")).toBeInTheDocument();

    // My teams queries the teams list scoped to the caller (localStorage userId = 7).
    await user.click(screen.getByRole("tab", { name: "My teams" }));
    expect(await screen.findByText("No managed teams")).toBeInTheDocument();

    const urls = mockFetch.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes("/api/v1/teams/members?view=member"))).toBe(true);
    expect(urls.some((url) => url.includes("/api/v1/teams/members?view=managed"))).toBe(true);
    expect(
      urls.some((url) => url.includes("/api/v1/teams?") && url.includes("managerId=7")),
    ).toBe(true);
  });

  test("honors ?tab=peers from the URL", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 })),
    );
    renderWithProviders(<Dashboard />, { route: "/?tab=peers" });

    expect(await screen.findByText("No teammates")).toBeInTheDocument();
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([url]) => String(url));
      expect(urls.some((url) => url.includes("/api/v1/teams/members?view=member"))).toBe(true);
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
      expect(urls.some((url) => url.includes("/api/v1/teams/members?view=managed"))).toBe(true);
    });
  });

  test("honors ?tab=myTeams from the URL", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 })),
    );
    renderWithProviders(<Dashboard />, { route: "/?tab=myTeams" });

    expect(await screen.findByText("No managed teams")).toBeInTheDocument();
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([url]) => String(url));
      expect(
        urls.some((url) => url.includes("/api/v1/teams?") && url.includes("managerId=7")),
      ).toBe(true);
    });
  });

  test("there is no reviews tab — the view moved to /performance (v1.45.0)", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 })),
    );
    renderWithProviders(<Dashboard />);

    expect(await screen.findByText("No managers")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Performance reviews" })).toBeNull();
  });

  test("a legacy ?tab=reviews bookmark redirects to /performance?tab=managed", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 })),
    );
    renderWithProviders(
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/performance" element={<div>PERFORMANCE_PAGE</div>} />
      </Routes>,
      { route: "/?tab=reviews" },
    );

    expect(await screen.findByText("PERFORMANCE_PAGE")).toBeInTheDocument();
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
      expect(urls.some((url) => url.includes("/api/v1/teams/members?view=managers"))).toBe(true);
    });
  });

  // The last-picked tab persists per device under `dashboard.tab` (v3.4.0).
  test("a stored tab pick restores on mount without a ?tab= param", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 })),
    );
    localStorage.setItem("lettuce.viewSettings.dashboard.tab", JSON.stringify("peers"));
    renderWithProviders(<Dashboard />, { route: "/" });

    expect(await screen.findByText("No teammates")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "My peers" })).toHaveAttribute("aria-selected", "true");
    const urls = mockFetch.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes("/api/v1/teams/members?view=managers"))).toBe(false);
  });

  test("an explicit ?tab= beats the stored pick", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 })),
    );
    localStorage.setItem("lettuce.viewSettings.dashboard.tab", JSON.stringify("peers"));
    renderWithProviders(<Dashboard />, { route: "/?tab=subordinates" });

    expect(await screen.findByText("No team members")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "My subordinates" })).toHaveAttribute("aria-selected", "true");
    // The URL wins for this visit only — the stored pick is untouched until the user clicks.
    expect(localStorage.getItem("lettuce.viewSettings.dashboard.tab")).toBe(JSON.stringify("peers"));
  });

  test("picking a tab stores it, and a corrupt stored value falls back to managers", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 })),
    );
    localStorage.setItem("lettuce.viewSettings.dashboard.tab", JSON.stringify("reviews"));
    const user = userEvent.setup();
    renderWithProviders(<Dashboard />, { route: "/" });

    expect(await screen.findByText("No managers")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "My teams" }));
    expect(await screen.findByText("No managed teams")).toBeInTheDocument();
    expect(localStorage.getItem("lettuce.viewSettings.dashboard.tab")).toBe(JSON.stringify("myTeams"));
  });
});
