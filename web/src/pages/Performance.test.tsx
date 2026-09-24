import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { renderWithProviders, screen, waitFor } from "../test/render";
import { TourContext } from "../components/tourSupport";
import Performance from "./Performance";
import { jsonResponse } from "../test/http";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

const NO_PERIODS_MESSAGE =
  "There are no review periods yet — an administrator creates them under Config → Review periods.";

// URL-routed mock: the managed-teams probe (drives the manager gate) + the queries either
// panel issues (own review list; the managed panel's periods/members/reviews fetches).
function mockApi(mockFetch: FetchMock, opts: { managerOfTeams?: number } = {}) {
  const { managerOfTeams = 0 } = opts;
  mockFetch.mockImplementation((url: string) => {
    const u = String(url);
    if (u.startsWith("/api/v1/teams?"))
      return Promise.resolve(
        jsonResponse(200, { items: [], page: 1, pageSize: 1, total: managerOfTeams }),
      );
    if (u.includes("/api/v1/review-periods"))
      return Promise.resolve(jsonResponse(200, { items: [] }));
    return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
  });
}

function reviewUrls(mockFetch: FetchMock): string[] {
  return mockFetch.mock.calls
    .map(([url]) => String(url))
    .filter((u) => u.startsWith("/api/v1/performance-reviews?"));
}

// The page's header now always renders a TutorialButton (useTour()), so every render needs a
// TourContext — a no-op startTutorial by default; the launcher test below supplies a spy (the
// MyGoals.test.tsx/DaysOff.test.tsx idiom).
function renderPerformance(route = "/performance", startTutorial: (id: string) => void = () => {}) {
  return renderWithProviders(
    <TourContext.Provider value={{ startTour: () => {}, startTutorial, launchTutorial: () => {} }}>
      <Performance />
    </TourContext.Provider>,
    { route },
  );
}

describe("Performance page", () => {
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

  test("non-manager: single My-performance tab listing the own (published-only) view", async () => {
    mockApi(mockFetch);
    renderPerformance();

    expect(await screen.findByRole("heading", { name: "Performance" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "My performance" })).toBeInTheDocument();
    expect(
      screen.getByText("The performance reviews your manager published about you, by period."),
    ).toBeInTheDocument();
    expect(await screen.findByText("No performance reviews")).toBeInTheDocument();

    // No manager gate passed → no second tab.
    await waitFor(() =>
      expect(mockFetch.mock.calls.some(([u]) => String(u).startsWith("/api/v1/teams?"))).toBe(true),
    );
    expect(screen.queryByRole("tab", { name: "Team's performance" })).not.toBeInTheDocument();
    // The own tab carries the tour anchor too — the tour steps through both tabs.
    expect(screen.getByRole("tab", { name: "My performance" })).toHaveAttribute(
      "data-tour",
      "performance-own",
    );

    expect(reviewUrls(mockFetch)[0]).toContain("view=own");
  });

  test("manager: the Team's-performance tab carries the tour anchor and opens the completion dashboard", async () => {
    mockApi(mockFetch, { managerOfTeams: 1 });
    const user = userEvent.setup();
    renderPerformance();

    const managedTab = await screen.findByRole("tab", { name: "Team's performance" });
    expect(managedTab).toHaveAttribute("data-tour", "performance-managed");
    await user.click(managedTab);

    // The moved ReviewsDashboard renders — with an empty timeline it points at the admin screen.
    expect(await screen.findByText(NO_PERIODS_MESSAGE)).toBeInTheDocument();
  });

  test("?tab=managed deep-links a manager straight to the Team's-performance tab", async () => {
    mockApi(mockFetch, { managerOfTeams: 1 });
    renderPerformance("/performance?tab=managed");

    expect(await screen.findByText(NO_PERIODS_MESSAGE)).toBeInTheDocument();
  });

  test("HR-only (non-manager): the Team's-performance tab is visible too (v4.3.0)", async () => {
    localStorage.setItem("lettuce.auth.roles", JSON.stringify(["HR"]));
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderPerformance();

    const managedTab = await screen.findByRole("tab", { name: "Team's performance" });
    await user.click(managedTab);

    expect(await screen.findByText(NO_PERIODS_MESSAGE)).toBeInTheDocument();
  });

  test("?tab=managed falls back to My performance for a non-manager", async () => {
    mockApi(mockFetch);
    renderPerformance("/performance?tab=managed");

    expect(await screen.findByText("No performance reviews")).toBeInTheDocument();
    expect(reviewUrls(mockFetch).at(-1)).toContain("view=own");
    expect(screen.queryByRole("tab", { name: "Team's performance" })).not.toBeInTheDocument();
  });

  test("the tutorial launcher starts the performance reviews tutorial via useTour", async () => {
    mockApi(mockFetch);
    const startTutorial = vi.fn();
    const user = userEvent.setup();
    renderPerformance("/performance", startTutorial);

    const launcher = await screen.findByRole("button", { name: "How performance reviews work" });
    await user.click(launcher);

    expect(startTutorial).toHaveBeenCalledWith("performanceReviews");
  });

  test("a disabled PERFORMANCE_REVIEWS feature redirects the page to / (v1.53.0)", async () => {
    localStorage.setItem("lettuce.auth.disabledFeatures", JSON.stringify(["PERFORMANCE_REVIEWS"]));
    try {
      mockApi(mockFetch);
      renderWithProviders(
        <>
          <Performance />
          <LocationProbe />
        </>,
        { route: "/performance" },
      );

      await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/));
      expect(screen.queryByRole("heading", { name: "Performance" })).toBeNull();
      expect(screen.queryByRole("tab", { name: "My performance" })).toBeNull();
    } finally {
      localStorage.removeItem("lettuce.auth.disabledFeatures");
    }
  });
});
