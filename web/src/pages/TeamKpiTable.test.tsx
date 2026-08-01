import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, renderWithProviders, screen, waitFor } from "../test/render";
import TeamKpiTable from "./TeamKpiTable";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

const BASE = {
  id: 1,
  teamId: 10,
  teamName: "Team AAA",
  teamDeleted: false,
  managerId: 7, // the caller manages this one
  managerName: "Me",
  managerDeleted: false,
  title: "Deploy weekly",
  type: "NUMBER",
  targetValue: 52,
  currentValue: 12,
  status: "ACTIVE",
  createdAt: new Date(2026, 5, 1).getTime(),
  lastModified: new Date(2026, 6, 1).getTime(),
};
const FOREIGN_ARCHIVED = {
  ...BASE,
  id: 2,
  managerId: 40,
  managerName: "Mona",
  title: "Bug backlog",
  type: "PERCENTAGE",
  targetValue: 100,
  currentValue: 80,
  status: "ARCHIVED",
};
const OWN_DRAFT = {
  ...BASE,
  id: 3,
  title: "Ship the docs",
  status: "DRAFT",
  targetValue: 8,
  currentValue: 0,
};

function mockApi(mockFetch: FetchMock, kpis: unknown[] = [BASE, FOREIGN_ARCHIVED, OWN_DRAFT]) {
  mockFetch.mockImplementation((url: string) => {
    const u = String(url);
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

describe("TeamKpiTable", () => {
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

  test("renders the columns with per-type values; only the manager's DRAFT rows offer Edit", async () => {
    mockApi(mockFetch);
    renderWithProviders(<TeamKpiTable view="managed" />);

    expect(await screen.findByText("Deploy weekly")).toBeInTheDocument();
    expect(screen.getAllByText("Team AAA").length).toBeGreaterThan(0);
    // NUMBER renders plain, PERCENTAGE with the % suffix.
    expect(screen.getByText("52")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();

    // The manager's DRAFT row opens the editor directly (v1.29.1); everything else — the
    // manager's own ACTIVE row included — opens the view screen, which owns the data-point
    // editing and lifecycle actions.
    expect(screen.getByRole("link", { name: "Edit team KPI Ship the docs" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View team KPI Deploy weekly" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View team KPI Bug backlog" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit team KPI Deploy weekly" })).not.toBeInTheDocument();
  });

  test("a soft-deleted team's row says so in the Team cell", async () => {
    mockApi(mockFetch, [{ ...BASE, teamName: "Team Gone", teamDeleted: true, status: "ARCHIVED" }]);
    renderWithProviders(<TeamKpiTable view="managed" settingsKey="teamKpis.test4" />);
    expect(await screen.findByText(/Team Gone \(deleted\)/)).toBeInTheDocument();
  });

  test("a pinned teamId hides the Team column and scopes the query", async () => {
    mockApi(mockFetch, [BASE]);
    renderWithProviders(<TeamKpiTable view="managed" teamId={10} settingsKey="teamKpis.test" />);

    expect(await screen.findByText("Deploy weekly")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Team" })).not.toBeInTheDocument();
    expect(kpiUrls(mockFetch)[0]).toContain("teamId=10");
  });

  test("title and status filters narrow the query", async () => {
    mockApi(mockFetch);
    renderWithProviders(<TeamKpiTable view="own" settingsKey="teamKpis.test2" />);
    await screen.findByText("Deploy weekly");

    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "deploy" } });
    await waitFor(() => expect(kpiUrls(mockFetch).some((u) => u.includes("title=deploy"))).toBe(true));

    fireEvent.click(screen.getByLabelText("Status", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "Active" }));
    await waitFor(() =>
      expect(kpiUrls(mockFetch).some((u) => u.includes("status=ACTIVE"))).toBe(true),
    );
  });

  test("empty list renders the empty state", async () => {
    mockApi(mockFetch, []);
    renderWithProviders(<TeamKpiTable view="own" settingsKey="teamKpis.test3" />);
    expect(await screen.findByText("No team KPIs yet.")).toBeInTheDocument();
  });
});
