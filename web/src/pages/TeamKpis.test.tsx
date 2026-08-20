import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithProviders, screen } from "../test/render";
import { Route, Routes } from "react-router-dom";
import TeamKpis from "./TeamKpis";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

const TEAM = { id: 10, name: "Team AAA", managerId: 7, memberIds: [8, 9] };
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

  test("a non-manager of the team gets no New button", async () => {
    mockApi(mockFetch, { ...TEAM, managerId: 99 });
    renderPage();

    expect(await screen.findByRole("heading", { name: "Team KPIs of Team AAA" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New team KPI" })).not.toBeInTheDocument();
  });

  test("an invalid team id redirects to the dashboard tab", async () => {
    mockApi(mockFetch);
    renderPage("/teams/abc/kpis");
    expect(await screen.findByTestId("elsewhere")).toBeInTheDocument();
  });
});
