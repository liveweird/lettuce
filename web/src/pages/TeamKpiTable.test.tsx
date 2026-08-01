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

function mockApi(mockFetch: FetchMock, kpis: unknown[] = [BASE, FOREIGN_ARCHIVED]) {
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

  test("renders the columns with per-type values; every row action is View", async () => {
    mockApi(mockFetch);
    renderWithProviders(<TeamKpiTable view="managed" />);

    expect(await screen.findByText("Deploy weekly")).toBeInTheDocument();
    expect(screen.getAllByText("Team AAA").length).toBeGreaterThan(0);
    // NUMBER renders plain, PERCENTAGE with the % suffix.
    expect(screen.getByText("52")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();

    // The row action is always View (v1.29.0) — even for the manager of an ACTIVE row; the
    // manager's affordances live on the view screen.
    expect(screen.getByRole("link", { name: "View team KPI Deploy weekly" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View team KPI Bug backlog" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Edit team KPI/ })).not.toBeInTheDocument();
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
