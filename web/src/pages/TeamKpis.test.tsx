import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "../test/render";
import { Route, Routes } from "react-router-dom";
import TeamKpis from "./TeamKpis";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";
const ROLE_KEY = "lettuce.auth.roles";

type FetchMock = ReturnType<typeof vi.fn>;

// canManageKpis is the server-computed gate (v2.34.0) — the old managerId inference is gone.
const TEAM = { id: 10, name: "Team AAA", managerId: 7, memberIds: [8, 9], canManageKpis: true };
const KPI = {
  id: 1,
  teamId: 10,
  teamName: "Team AAA",
  teamDeleted: false,
  managerId: 7,
  managerName: "Me",
  creatorId: 7,
  creatorName: "Me",
  creatorDeleted: false,
  canManage: true,
  canRecordValues: true,
  managerDeleted: false,
  title: "Deploy weekly",
  type: "NUMBER",
  targetValue: 52,
  currentValue: 12,
  status: "ACTIVE",
  createdAt: Date.now(),
  lastModified: Date.now(),
};

function mockApi(mockFetch: FetchMock, team: unknown = TEAM) {
  mockFetch.mockImplementation((url: string) => {
    const u = String(url);
    if (u === "/api/v1/teams/10") return Promise.resolve(jsonResponse(200, team));
    if (u.startsWith("/api/v1/team-kpis?"))
      return Promise.resolve(jsonResponse(200, { items: [KPI], page: 1, pageSize: 20, total: 1 }));
    return Promise.resolve(jsonResponse(404, {}));
  });
}

function renderPage(route = "/teams/10/kpis") {
  return renderWithProviders(
    <Routes>
      <Route path="/teams/:teamId/kpis" element={<TeamKpis />} />
      <Route path="*" element={<div data-testid="elsewhere" />} />
    </Routes>,
    { route },
  );
}

describe("TeamKpis drill-down", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders the team-named heading, the pinned table, and the manager's New button", async () => {
    mockApi(mockFetch);
    renderPage();

    expect(await screen.findByRole("heading", { name: "Team KPIs of Team AAA" })).toBeInTheDocument();
    expect(await screen.findByText("Deploy weekly")).toBeInTheDocument();
    // The Team column is hidden — the page names the team.
    expect(screen.queryByRole("button", { name: "Team" })).not.toBeInTheDocument();
    // The pinned query carries teamId; the create link prefills the team and the return target.
    const kpiUrl = mockFetch.mock.calls.map(([u]) => String(u)).find((u) => u.includes("/team-kpis?"));
    expect(kpiUrl).toContain("teamId=10");
    const create = screen.getByRole("link", { name: "New team KPI" });
    expect(create.getAttribute("href")).toContain("teamId=10");
    expect(create.getAttribute("href")).toContain(`back=${encodeURIComponent("/teams/10/kpis")}`);
    // The back anchor returns to the dashboard tab.
    expect(screen.getByRole("link", { name: /Back to My teams/ })).toHaveAttribute(
      "href",
      "/?tab=myTeams",
    );
  });

  test("a caller without the KPI capability gets no New button", async () => {
    mockApi(mockFetch, { ...TEAM, canManageKpis: false });
    renderPage();

    expect(await screen.findByRole("heading", { name: "Team KPIs of Team AAA" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New team KPI" })).not.toBeInTheDocument();
  });

  test("an invalid team id redirects to the dashboard tab", async () => {
    mockApi(mockFetch);
    renderPage("/teams/abc/kpis");
    expect(await screen.findByTestId("elsewhere")).toBeInTheDocument();
  });

  test("a manager (canManageKpis) gets the managed view, even when also HR (v3.24.0)", async () => {
    // The team query settles AFTER first render, so a fleeting first fetch may still carry
    // the pre-settlement view — assert the SETTLED query, the kpiUrls().at(-1) idiom used
    // elsewhere (MyTeamKpis.test.tsx), not merely that view=managed appears at some point.
    localStorage.setItem(ROLE_KEY, JSON.stringify(["HR"]));
    mockApi(mockFetch, { ...TEAM, canManageKpis: true });
    renderPage();

    expect(await screen.findByText("Deploy weekly")).toBeInTheDocument();
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith("/api/v1/team-kpis?"));
      expect(urls.at(-1)).toContain("view=managed");
    });
  });

  test("an HR auditor who does not manage the team gets the org-wide view=all list with an auditor hint (v3.24.0)", async () => {
    localStorage.setItem(ROLE_KEY, JSON.stringify(["HR"]));
    mockApi(mockFetch, { ...TEAM, canManageKpis: false });
    renderPage();

    expect(await screen.findByText("Deploy weekly")).toBeInTheDocument();
    const kpiUrl = mockFetch.mock.calls.map(([u]) => String(u)).find((u) => u.includes("/team-kpis?"));
    expect(kpiUrl).toContain("view=all");
    // The auditor-flavored hint line replaces the ordinary one.
    expect(
      screen.getByText(/an auditor view, since you don't manage this team\. This access is recorded\./),
    ).toBeInTheDocument();
    // No New-KPI button either — the auditor cannot manage this team.
    expect(screen.queryByRole("link", { name: "New team KPI" })).not.toBeInTheDocument();
  });

  test("a plain member (no manage right, no HR) gets the managed view — never the auditor view", async () => {
    mockApi(mockFetch, { ...TEAM, canManageKpis: false });
    renderPage();

    await screen.findByRole("heading", { name: "Team KPIs of Team AAA" });
    await waitFor(() => {
      const kpiUrl = mockFetch.mock.calls.map(([u]) => String(u)).find((u) => u.includes("/team-kpis?"));
      expect(kpiUrl).toContain("view=managed");
    });
  });

  test("?from=team routes the back link to the team's own details page instead of My teams", async () => {
    mockApi(mockFetch);
    renderPage("/teams/10/kpis?from=team");

    expect(await screen.findByRole("link", { name: "← Back to Team AAA" })).toHaveAttribute(
      "href",
      "/teams/10/details",
    );
    expect(screen.queryByRole("link", { name: /Back to My teams/ })).not.toBeInTheDocument();
  });

  test("without ?from=team the back link keeps returning to the dashboard tab (default, unchanged)", async () => {
    mockApi(mockFetch);
    renderPage();

    expect(await screen.findByRole("link", { name: /Back to My teams/ })).toHaveAttribute(
      "href",
      "/?tab=myTeams",
    );
  });
});
