import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, screen } from "../test/render";
import CareerPyramid from "./CareerPyramid";
import { jsonResponse } from "../test/http";

type FetchMock = ReturnType<typeof vi.fn>;

const ENTRY = (id: number, value: string) => ({ id, values: { en: value } });

// Full-history payload (v2.17.0). Alice's TODAY view matches the old flat fixture (Senior
// since 2023-01-10, in the org since 2019-06-01); her first position carries the "Regular"
// seniority the time-travel test looks for. Carol is deactivated with a stamped end — she
// must never render at today, only when the slider covers her interval.
const ITEMS = [
  {
    userId: 1,
    name: "Alice Anchor",
    deactivated: false,
    positions: [
      {
        startDate: "2019-06-01",
        endDate: "2023-01-09",
        careerPath: ENTRY(11, "Engineer"),
        careerSpecialization: ENTRY(21, "Backend"),
        seniorityLevel: ENTRY(30, "Regular"),
      },
      {
        startDate: "2023-01-10",
        endDate: null,
        careerPath: ENTRY(11, "Engineer"),
        careerSpecialization: ENTRY(21, "Backend"),
        seniorityLevel: ENTRY(31, "Senior"),
      },
    ],
  },
  { userId: 2, name: "Bob Blank", deactivated: false, positions: [] },
  {
    userId: 3,
    name: "Carol Gone",
    deactivated: true,
    positions: [
      {
        startDate: "2020-02-01",
        endDate: "2024-05-31",
        careerPath: ENTRY(12, "Manager"),
        careerSpecialization: ENTRY(21, "Backend"),
        seniorityLevel: ENTRY(31, "Senior"),
      },
    ],
  },
];

function mockApi(mockFetch: FetchMock) {
  mockFetch.mockImplementation((url: string) => {
    const u = String(url);
    if (u.startsWith("/api/v1/career/pyramid"))
      return Promise.resolve(jsonResponse(200, { items: ITEMS, earliestStartDate: "2019-06-01" }));
    if (u.includes("/api/v1/dictionaries/career-paths"))
      return Promise.resolve(jsonResponse(200, { items: [ENTRY(11, "Engineer"), ENTRY(12, "Manager")] }));
    if (u.startsWith("/api/v1/dictionaries/"))
      return Promise.resolve(jsonResponse(200, { items: [] }));
    return Promise.resolve(jsonResponse(200, { items: [] }));
  });
}

function pyramidUrls(mockFetch: FetchMock): string[] {
  return mockFetch.mock.calls
    .map(([url]) => String(url))
    .filter((u) => u.startsWith("/api/v1/career/pyramid"));
}

describe("CareerPyramid", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.userId", "7");
    // Start with the filter panel expanded — its collapsed default hides every filter input.
    localStorage.setItem("lettuce.viewSettings.career.pyramid.filtersOpen", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders rows with the triple, humanized tenures, Not-set cells, and details links", async () => {
    mockApi(mockFetch);
    renderWithProviders(<CareerPyramid />);

    // "Engineer" also exists as the career-paths Select's MOUNTED option (the closed-Select
    // listbox gotcha) — wait on the unique person name and count the text instead.
    expect(await screen.findByText("Alice Anchor")).toBeInTheDocument();
    expect(screen.getAllByText("Engineer").length).toBeGreaterThanOrEqual(1);
    // Alice's row: linked name + tenures derived from the anchors (non-empty text).
    const alice = screen.getByRole("link", { name: "User details for Alice Anchor" });
    expect(alice).toHaveAttribute(
      "href",
      "/users/1/details?name=Alice+Anchor&from=career",
    );
    // Bob's row: all four value cells say Not set.
    expect(screen.getAllByText("Not set").length).toBeGreaterThanOrEqual(4);
    // Carol is deactivated with an ended position — at today she is dropped, not "Not set".
    expect(screen.queryByText("Carol Gone")).not.toBeInTheDocument();
    // Direct scope by default — no includeIndirect param.
    expect(pyramidUrls(mockFetch)[0]).toBe("/api/v1/career/pyramid");
  });

  test("the time slider re-renders the table as of a past date and Today resets it", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<CareerPyramid />);
    await screen.findByText("Alice Anchor");

    // Default = today: no "As of" badge, Alice shows her CURRENT seniority.
    expect(screen.queryByText(/As of/)).not.toBeInTheDocument();
    expect(screen.getByText("Senior")).toBeInTheDocument();

    // Home jumps the slider to its minimum — the org-wide earliest start (2019-06-01).
    const slider = screen.getByRole("slider", { name: "Show the pyramid as of a past date" });
    fireEvent.keyDown(slider, { key: "Home" });

    expect(await screen.findByText(/As of/)).toBeInTheDocument();
    // Alice's FIRST position starts exactly on that date → her historical seniority shows...
    expect(screen.getByText("Regular")).toBeInTheDocument();
    expect(screen.queryByText("Senior")).not.toBeInTheDocument();
    // ...Bob (active, no positions yet) stays as Not set, Carol (deactivated, not started
    // until 2020) stays dropped.
    expect(screen.getByText("Bob Blank")).toBeInTheDocument();
    expect(screen.queryByText("Carol Gone")).not.toBeInTheDocument();

    // The Today button resets to the default view. (Interval membership — Carol coming
    // back mid-range — is pinned by the careerPyramid.ts unit tests; the keyboard step
    // sizes here depend on the live range, so the UI test stays on the deterministic ends.)
    await user.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() => expect(screen.queryByText(/As of/)).not.toBeInTheDocument());
    expect(screen.getByText("Senior")).toBeInTheDocument();
  });

  test("the reports scope refetches with includeIndirect", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<CareerPyramid />);
    await screen.findByText("Alice Anchor");

    fireEvent.click(screen.getByLabelText("Reports", { selector: "input" }));
    await user.click(await screen.findByRole("option", { name: "All reports (including indirect)" }));
    await waitFor(() =>
      expect(pyramidUrls(mockFetch)).toContain("/api/v1/career/pyramid?includeIndirect=true"),
    );
  });

  test("the name filter narrows rows and the career Selects offer Not set", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<CareerPyramid />);
    await screen.findByText("Alice Anchor");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "blank" } });
    await waitFor(() =>
      expect(screen.queryByText("Alice Anchor")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Bob Blank")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });
    await screen.findByText("Alice Anchor");

    // Career path = Not set → only Bob survives.
    fireEvent.click(screen.getByLabelText("Career path", { selector: "input" }));
    await user.click(await screen.findByRole("option", { name: "Not set" }));
    await waitFor(() => expect(screen.queryByText("Alice Anchor")).not.toBeInTheDocument());
    expect(screen.getByText("Bob Blank")).toBeInTheDocument();
  });

  test("sorting by tenure at level puts the longest first and Not set last", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<CareerPyramid />);
    await screen.findByText("Alice Anchor");

    await user.click(screen.getByRole("button", { name: /Tenure at level/ }));
    const cells = screen.getAllByRole("row").slice(1); // skip the header row
    expect(cells[0]).toHaveTextContent("Alice Anchor");
    expect(cells[1]).toHaveTextContent("Bob Blank");
  });

  test("the chart view replaces the table and mounts the lazy distribution chart", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<CareerPyramid />);
    await screen.findByText("Alice Anchor");

    await user.click(screen.getByText("Chart", { exact: true }));
    // The metric Select mounts (lazy chunk) and the table is gone.
    expect(await screen.findByLabelText("Distribution of", { selector: "input" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
