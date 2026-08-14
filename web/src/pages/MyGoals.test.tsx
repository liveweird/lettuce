import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { fireEvent, renderWithProviders, screen, waitFor } from "../test/render";
import MyGoals from "./MyGoals";
import { jsonResponse } from "../test/http";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

// Goals from two different managers — the whole point of the cross-manager own list.
const FROM_ALICE = {
  id: 1,
  managerId: 10,
  managerName: "Alice",
  managerDeleted: false,
  subordinateId: 7,
  subordinateName: "Me",
  subordinateDeleted: false,
  title: "Ship four reports",
  type: "NUMBER",
  targetValue: 4,
  currentValue: 1,
  milestonesDone: null,
  milestonesTotal: null,
  status: "ACTIVE",
  createdAt: new Date(2026, 5, 1).getTime(),
  dueDate: "2099-06-15",
  lastModified: new Date(2026, 6, 1).getTime(),
};
const FROM_BOB = {
  ...FROM_ALICE,
  id: 2,
  managerId: 11,
  managerName: "Bob",
  title: "Raise coverage",
  type: "PERCENTAGE",
  targetValue: 90,
  currentValue: 45,
};
// A goal the caller (id 7) set for a report — the managed tab's shape.
const SET_FOR_CAROL = {
  ...FROM_ALICE,
  id: 3,
  managerId: 7,
  managerName: "Me",
  subordinateId: 20,
  subordinateName: "Carol",
  title: "Mentor the intern",
};

// URL-routed mock: the managed-teams probe (drives the manager gate) + the goals list.
function mockApi(mockFetch: FetchMock, opts: { managerOfTeams?: number; goals?: unknown[] } = {}) {
  const { managerOfTeams = 0, goals = [FROM_ALICE, FROM_BOB] } = opts;
  mockFetch.mockImplementation((url: string) => {
    const u = String(url);
    if (u.startsWith("/api/v1/teams?"))
      return Promise.resolve(
        jsonResponse(200, { items: [], page: 1, pageSize: 1, total: managerOfTeams }),
      );
    if (u.startsWith("/api/v1/goals?"))
      return Promise.resolve(
        jsonResponse(200, { items: goals, page: 1, pageSize: 20, total: goals.length }),
      );
    return Promise.resolve(jsonResponse(404, {}));
  });
}

function goalUrls(mockFetch: FetchMock): string[] {
  return mockFetch.mock.calls
    .map(([url]) => String(url))
    .filter((u) => u.startsWith("/api/v1/goals?"));
}

describe("MyGoals page", () => {
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

  test("non-manager: single My-goals tab listing own goals with the Manager column", async () => {
    mockApi(mockFetch);
    renderWithProviders(<MyGoals />);

    expect(await screen.findByRole("heading", { name: "Goals" })).toBeInTheDocument();
    // The tab carries the guided tour's anchor.
    expect(screen.getByRole("tab", { name: "My goals" })).toHaveAttribute(
      "data-tour",
      "goals-own",
    );
    // Wait for the rows, not just the chrome (the tab renders before the data arrives).
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manager" })).toBeInTheDocument(); // sortable header

    // No manager gate passed → no second tab.
    await waitFor(() =>
      expect(mockFetch.mock.calls.some(([u]) => String(u).startsWith("/api/v1/teams?"))).toBe(true),
    );
    expect(screen.queryByRole("tab", { name: "Goals I've set" })).not.toBeInTheDocument();

    const url = goalUrls(mockFetch)[0];
    expect(url).toContain("view=own");
    expect(url).not.toContain("managerId=");
    expect(url).not.toContain("includeIndirect");
  });

  test("own rows carry no back override — the detail pages already default to /goals", async () => {
    mockApi(mockFetch);
    renderWithProviders(<MyGoals />);

    // The caller is the subordinate of this ACTIVE row → the Update entry point (v2.8.0).
    const update = await screen.findByRole("link", { name: "Update goal Ship four reports" });
    expect(update).toHaveAttribute("href", expect.stringContaining("from=own"));
    expect(update.getAttribute("href")).not.toContain("back=");
  });

  test("manager: the Goals-I've-set tab lists view=managed with the Team-member column and tab-preserving back links", async () => {
    mockApi(mockFetch, { managerOfTeams: 1, goals: [SET_FOR_CAROL] });
    const user = userEvent.setup();
    renderWithProviders(<MyGoals />);

    const managedTab = await screen.findByRole("tab", { name: "Goals I've set" });
    // The manager-only tab carries the guided tour's anchor.
    expect(managedTab).toHaveAttribute("data-tour", "goals-managed");
    await user.click(managedTab);

    expect(await screen.findByText("Carol")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Team member" })).toBeInTheDocument();
    await waitFor(() => {
      const managed = goalUrls(mockFetch).find((u) => u.includes("view=managed"));
      expect(managed).toBeDefined();
      expect(managed).not.toContain("includeIndirect");
    });

    // Row actions return to this tab, not the default own tab (ACTIVE + manager → Update).
    const update = screen.getByRole("link", { name: "Update goal Mentor the intern" });
    expect(update.getAttribute("href")).toContain(`back=${encodeURIComponent("/goals?tab=managed")}`);

    // The footer create entry point (v1.30.1 — the MyTeamKpis pattern): unprefilled create,
    // returning to this tab.
    const create = screen.getByRole("link", { name: "New goal" });
    expect(create.getAttribute("href")).toContain("/goals/new");
    expect(create.getAttribute("href")).not.toContain("subordinateId");
    expect(create.getAttribute("href")).toContain(`back=${encodeURIComponent("/goals?tab=managed")}`);
  });

  test("manager: switching Reports to all adds includeIndirect=true to the managed query", async () => {
    mockApi(mockFetch, { managerOfTeams: 1, goals: [SET_FOR_CAROL] });
    const user = userEvent.setup();
    renderWithProviders(<MyGoals />);

    await user.click(await screen.findByRole("tab", { name: "Goals I've set" }));
    await screen.findByText("Carol");

    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(screen.getByLabelText("Reports", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "All reports (including indirect)" }));

    await waitFor(() =>
      expect(goalUrls(mockFetch).some((u) => u.includes("includeIndirect=true"))).toBe(true),
    );

    // Back to direct: the param drops again.
    fireEvent.click(screen.getByLabelText("Reports", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "Direct reports only" }));
    await waitFor(() => {
      const last = goalUrls(mockFetch).at(-1);
      expect(last).not.toContain("includeIndirect");
    });
  });

  test("?tab=managed deep-links a manager to the managed tab", async () => {
    mockApi(mockFetch, { managerOfTeams: 1, goals: [SET_FOR_CAROL] });
    renderWithProviders(<MyGoals />, { route: "/goals?tab=managed" });

    expect(await screen.findByText("Carol")).toBeInTheDocument();
    expect(goalUrls(mockFetch).at(-1)).toContain("view=managed");
  });

  test("?tab=managed falls back to My goals for a non-manager", async () => {
    mockApi(mockFetch);
    renderWithProviders(<MyGoals />, { route: "/goals?tab=managed" });

    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(goalUrls(mockFetch).at(-1)).toContain("view=own");
    expect(screen.queryByRole("tab", { name: "Goals I've set" })).not.toBeInTheDocument();
  });

  test("a disabled GOALS feature redirects the page to / (v1.53.0)", async () => {
    localStorage.setItem("lettuce.auth.disabledFeatures", JSON.stringify(["GOALS"]));
    try {
      mockApi(mockFetch);
      renderWithProviders(
        <>
          <MyGoals />
          <LocationProbe />
        </>,
        { route: "/goals" },
      );

      await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/));
      expect(screen.queryByRole("heading", { name: "Goals" })).toBeNull();
      expect(screen.queryByRole("tab", { name: "My goals" })).toBeNull();
    } finally {
      localStorage.removeItem("lettuce.auth.disabledFeatures");
    }
  });
});
