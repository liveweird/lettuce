import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "../test/render";
import MyTeamsTable from "./MyTeamsTable";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

const MANAGED_TEAMS = [
  { id: 3, name: "Platform", managerId: 7, managerName: "Me", managerDeleted: false },
  { id: 5, name: "Support", managerId: 7, managerName: "Me", managerDeleted: false },
];

function teamsPage(items: unknown[], total = items.length): Response {
  return jsonResponse(200, { items, page: 1, pageSize: 20, total });
}

function teamUrls(mockFetch: FetchMock): string[] {
  return mockFetch.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith("/api/v1/teams?"));
}

describe("MyTeamsTable", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn(() => Promise.resolve(teamsPage(MANAGED_TEAMS)));
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("lists the caller's managed teams — the name links to team details with the myTeams origin", async () => {
    renderWithProviders(<MyTeamsTable />);

    expect(await screen.findByText("Platform")).toBeInTheDocument();
    expect(screen.getByText("Support")).toBeInTheDocument();
    // Server-side scoping: the caller's id rides in every query.
    expect(teamUrls(mockFetch)[0]).toContain("managerId=7");
    expect(teamUrls(mockFetch)[0]).toContain("sort=name");

    // The team name links to the team-details view (where a manager lands on their
    // subordinates grid, v2.5.5); ?from=myTeams routes the back link to this tab.
    expect(screen.getByRole("link", { name: "Team details for Platform" })).toHaveAttribute(
      "href",
      "/teams/3/details?from=myTeams",
    );
    expect(screen.getByRole("link", { name: "Team details for Support" })).toHaveAttribute(
      "href",
      "/teams/5/details?from=myTeams",
    );
    // No dedicated Subordinates button remains (v2.5.5).
    expect(screen.queryByRole("link", { name: /subordinates of /i })).toBeNull();

    // And a Team-KPIs button opening the team's KPI drill-down (v1.27.0).
    expect(screen.getByRole("link", { name: "Team KPIs of Platform" })).toHaveAttribute(
      "href",
      "/teams/3/kpis",
    );
    expect(screen.getByRole("link", { name: "Team KPIs of Support" })).toHaveAttribute(
      "href",
      "/teams/5/kpis",
    );
  });

  test("a disabled TEAM_KPIS feature hides the per-team Team KPIs button; the name link stays (v1.53.0)", async () => {
    localStorage.setItem("lettuce.auth.disabledFeatures", JSON.stringify(["TEAM_KPIS"]));
    try {
      renderWithProviders(<MyTeamsTable />);

      expect(await screen.findByRole("link", { name: "Team details for Platform" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Team details for Support" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /team kpis of /i })).toBeNull();
    } finally {
      localStorage.removeItem("lettuce.auth.disabledFeatures");
    }
  });

  test("the name filter lands in the query string", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MyTeamsTable />);
    await screen.findByText("Platform");

    await user.click(screen.getByRole("button", { name: /filters/i }));
    await user.type(screen.getByLabelText("Name"), "plat");
    await waitFor(() => {
      expect(teamUrls(mockFetch).some((u) => u.includes("name=plat"))).toBe(true);
    });
  });

  test("the Name header toggles the sort direction", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MyTeamsTable />);
    await screen.findByText("Platform");

    await user.click(screen.getByRole("button", { name: "Name" }));
    await waitFor(() => {
      expect(
        teamUrls(mockFetch).some((u) => u.includes(`sort=${encodeURIComponent("-name")}`)),
      ).toBe(true);
    });
  });

  test("shows the empty state when the caller manages no team", async () => {
    mockFetch.mockImplementation(() => Promise.resolve(teamsPage([])));
    renderWithProviders(<MyTeamsTable />);

    expect(await screen.findByText("No managed teams")).toBeInTheDocument();
  });

  test("shows a titled error alert when the list fails to load", async () => {
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse(500, { title: "boom" })));
    renderWithProviders(<MyTeamsTable />);

    expect(await screen.findByText("Failed to load teams")).toBeInTheDocument();
  });
});
