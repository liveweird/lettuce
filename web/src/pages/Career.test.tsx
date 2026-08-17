import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "../test/render";
import Career from "./Career";
import { jsonResponse } from "../test/http";

type FetchMock = ReturnType<typeof vi.fn>;

const ENTRY = (id: number, value: string) => ({ id, values: { en: value } });

const OWN_POSITIONS = [
  {
    id: 1,
    startDate: "2020-05-01",
    endDate: null,
    careerPath: ENTRY(11, "Engineer"),
    careerSpecialization: ENTRY(21, "Backend"),
    seniorityLevel: ENTRY(31, "Senior"),
    createdAt: 1_600_000_000_000,
    lastModified: 1_600_000_000_000,
  },
];

// URL-routed mock: the managed-teams probe (the manager gate), the caller's own timeline,
// and the pyramid tab's queries (pyramid rows + the three filter dictionaries).
function mockApi(mockFetch: FetchMock, opts: { managerOfTeams?: number } = {}) {
  const { managerOfTeams = 0 } = opts;
  mockFetch.mockImplementation((url: string) => {
    const u = String(url);
    if (u.startsWith("/api/v1/teams?"))
      return Promise.resolve(
        jsonResponse(200, { items: [], page: 1, pageSize: 1, total: managerOfTeams }),
      );
    if (u.includes("/career-positions"))
      return Promise.resolve(jsonResponse(200, { items: OWN_POSITIONS }));
    if (u.startsWith("/api/v1/career/pyramid"))
      return Promise.resolve(jsonResponse(200, { items: [] }));
    if (u.startsWith("/api/v1/dictionaries/"))
      return Promise.resolve(jsonResponse(200, { items: [] }));
    return Promise.resolve(jsonResponse(200, { items: [] }));
  });
}

describe("Career page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.userId", "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("non-manager: single My-career tab rendering the OWN read-only timeline", async () => {
    mockApi(mockFetch);
    renderWithProviders(<Career />, { route: "/career" });

    expect(await screen.findByRole("heading", { name: "Career" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "My career" })).toHaveAttribute(
      "data-tour",
      "career-my",
    );
    // The own timeline loads for user 7 and renders read-only (no editor buttons).
    expect(await screen.findByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Engineer")).toBeInTheDocument();
    expect(
      mockFetch.mock.calls.some(([u]) => String(u) === "/api/v1/users/7/career-positions"),
    ).toBe(true);
    expect(screen.queryByLabelText(/^Edit the position/)).not.toBeInTheDocument();

    // No manager gate passed → no pyramid tab, and ?tab=pyramid falls back to "my".
    await waitFor(() =>
      expect(mockFetch.mock.calls.some(([u]) => String(u).startsWith("/api/v1/teams?"))).toBe(true),
    );
    expect(screen.queryByRole("tab", { name: "Team pyramid" })).not.toBeInTheDocument();
  });

  test("a ?tab=pyramid deep link falls back to My career for a non-manager", async () => {
    mockApi(mockFetch);
    renderWithProviders(<Career />, { route: "/career?tab=pyramid" });
    expect(await screen.findByText("Current")).toBeInTheDocument();
    expect(mockFetch.mock.calls.some(([u]) => String(u).startsWith("/api/v1/career/pyramid"))).toBe(
      false,
    );
  });

  test("a manager gets the pyramid tab (tour-anchored) and ?tab=pyramid opens it", async () => {
    mockApi(mockFetch, { managerOfTeams: 1 });
    renderWithProviders(<Career />, { route: "/career?tab=pyramid" });

    const pyramidTab = await screen.findByRole("tab", { name: "Team pyramid" });
    expect(pyramidTab).toHaveAttribute("data-tour", "career-pyramid");
    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(([u]) => String(u).startsWith("/api/v1/career/pyramid")),
      ).toBe(true),
    );
    expect(await screen.findByText("Nobody reports to you in this scope.")).toBeInTheDocument();
  });
});
