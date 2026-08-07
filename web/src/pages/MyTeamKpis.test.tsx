import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { renderWithProviders, screen, waitFor } from "../test/render";
import MyTeamKpis from "./MyTeamKpis";
import { jsonResponse } from "../test/http";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

// KPIs of two different teams — the member view spans every team the caller belongs to.
const AAA_KPI = {
  id: 1,
  teamId: 10,
  teamName: "Team AAA",
  teamDeleted: false,
  managerId: 40,
  managerName: "Mona",
  managerDeleted: false,
  title: "Deploy weekly",
  type: "NUMBER",
  targetValue: 52,
  currentValue: 12,
  status: "ACTIVE",
  createdAt: new Date(2026, 5, 1).getTime(),
  lastModified: new Date(2026, 6, 1).getTime(),
};
const BBB_KPI = {
  ...AAA_KPI,
  id: 2,
  teamId: 11,
  teamName: "Team BBB",
  title: "Bug backlog under 20",
  type: "PERCENTAGE",
  targetValue: 100,
  currentValue: 45,
};
// A KPI the caller (id 7) set as manager — the managed tab's shape (a DRAFT lists there).
const MANAGED_KPI = {
  ...AAA_KPI,
  id: 3,
  teamId: 12,
  teamName: "Team CCC",
  managerId: 7,
  managerName: "Me",
  title: "Cut lead time",
  status: "DRAFT",
};

// URL-routed mock: the managed-teams probe (drives the manager gate) + the KPI list.
function mockApi(mockFetch: FetchMock, opts: { managerOfTeams?: number; kpis?: unknown[] } = {}) {
  const { managerOfTeams = 0, kpis = [AAA_KPI, BBB_KPI] } = opts;
  mockFetch.mockImplementation((url: string) => {
    const u = String(url);
    if (u.startsWith("/api/v1/teams?"))
      return Promise.resolve(
        jsonResponse(200, { items: [], page: 1, pageSize: 1, total: managerOfTeams }),
      );
    if (u.startsWith("/api/v1/team-kpis?"))
      return Promise.resolve(
        jsonResponse(200, { items: kpis, page: 1, pageSize: 20, total: kpis.length }),
      );
    return Promise.resolve(jsonResponse(404, {}));
  });
}

function kpiUrls(mockFetch: FetchMock): string[] {
  return mockFetch.mock.calls
    .map(([url]) => String(url))
    .filter((u) => u.startsWith("/api/v1/team-kpis?"));
}

describe("MyTeamKpis page", () => {
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

  test("non-manager: single member tab listing own KPIs with the Team column", async () => {
    mockApi(mockFetch);
    renderWithProviders(<MyTeamKpis />);

    expect(await screen.findByRole("heading", { name: "Team KPIs" })).toBeInTheDocument();
    // The tab carries the guided tour's anchor.
    expect(screen.getByRole("tab", { name: "My teams' KPIs" })).toHaveAttribute(
      "data-tour",
      "team-kpis-own",
    );
    // Wait for the rows, not just the chrome; both teams' KPIs list together.
    expect(await screen.findByText("Team AAA")).toBeInTheDocument();
    expect(screen.getByText("Team BBB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Team" })).toBeInTheDocument(); // sortable header

    // No manager gate passed → no second tab and no create button.
    await waitFor(() =>
      expect(mockFetch.mock.calls.some(([u]) => String(u).startsWith("/api/v1/teams?"))).toBe(true),
    );
    expect(screen.queryByRole("tab", { name: "KPIs I've set" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New team KPI" })).not.toBeInTheDocument();

    const url = kpiUrls(mockFetch)[0];
    expect(url).toContain("view=own");
  });

  test("member rows offer View (the caller is not the manager)", async () => {
    mockApi(mockFetch);
    renderWithProviders(<MyTeamKpis />);

    const view = await screen.findByRole("link", { name: "View team KPI Deploy weekly" });
    expect(view).toHaveAttribute("href", expect.stringContaining("/team-kpis/1/view"));
  });

  test("manager: the KPIs-I've-set tab lists view=managed with the New-KPI button and back links", async () => {
    mockApi(mockFetch, { managerOfTeams: 1, kpis: [MANAGED_KPI] });
    const user = userEvent.setup();
    renderWithProviders(<MyTeamKpis />);

    const managedTab = await screen.findByRole("tab", { name: "KPIs I've set" });
    // The manager-only tab carries the guided tour's anchor.
    expect(managedTab).toHaveAttribute("data-tour", "team-kpis-managed");
    await user.click(managedTab);

    expect(await screen.findByText("Team CCC")).toBeInTheDocument();
    await waitFor(() => {
      expect(kpiUrls(mockFetch).find((u) => u.includes("view=managed"))).toBeDefined();
    });

    // The manager's DRAFT row opens the editor directly (v1.29.1), returning to this tab.
    const edit = screen.getByRole("link", { name: "Edit team KPI Cut lead time" });
    expect(edit.getAttribute("href")).toContain(
      `back=${encodeURIComponent("/team-kpis?tab=managed")}`,
    );

    // The create entry point carries the same return target.
    const create = screen.getByRole("link", { name: "New team KPI" });
    expect(create.getAttribute("href")).toContain("/team-kpis/new");
    expect(create.getAttribute("href")).toContain(
      `back=${encodeURIComponent("/team-kpis?tab=managed")}`,
    );
  });

  test("?tab=managed falls back to the member tab for a non-manager", async () => {
    mockApi(mockFetch);
    renderWithProviders(<MyTeamKpis />, { route: "/team-kpis?tab=managed" });

    expect(await screen.findByText("Team AAA")).toBeInTheDocument();
    expect(kpiUrls(mockFetch).at(-1)).toContain("view=own");
    expect(screen.queryByRole("tab", { name: "KPIs I've set" })).not.toBeInTheDocument();
  });

  test("a disabled TEAM_KPIS feature redirects the page to / (v1.53.0)", async () => {
    localStorage.setItem("lettuce.auth.disabledFeatures", JSON.stringify(["TEAM_KPIS"]));
    try {
      mockApi(mockFetch);
      renderWithProviders(
        <>
          <MyTeamKpis />
          <LocationProbe />
        </>,
        { route: "/team-kpis" },
      );

      await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/));
      expect(screen.queryByRole("heading", { name: "Team KPIs" })).toBeNull();
      expect(screen.queryByRole("tab", { name: "My teams' KPIs" })).toBeNull();
    } finally {
      localStorage.removeItem("lettuce.auth.disabledFeatures");
    }
  });
});
