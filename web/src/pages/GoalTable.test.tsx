import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, renderWithProviders, screen, waitFor } from "../test/render";
import GoalTable from "./GoalTable";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

const BASE = {
  managerId: 10,
  managerName: "Alice",
  managerDeleted: false,
  subordinateId: 7,
  subordinateName: "Me",
  subordinateDeleted: false,
  createdAt: new Date(2026, 5, 1).getTime(),
  lastModified: new Date(2026, 6, 1).getTime(),
};

const NUMBER_GOAL = {
  ...BASE,
  id: 1,
  title: "Ship four reports",
  type: "NUMBER",
  targetValue: 4,
  currentValue: 1.5,
  achieved: null,
  status: "ACTIVE",
};

const PERCENTAGE_GOAL = {
  ...BASE,
  id: 2,
  title: "Raise coverage",
  type: "PERCENTAGE",
  targetValue: 90,
  currentValue: 45,
  achieved: null,
  status: "DRAFT",
};

const BINARY_GOAL = {
  ...BASE,
  id: 3,
  title: "Get certified",
  type: "BINARY",
  targetValue: null,
  currentValue: null,
  achieved: false,
  status: "CLOSED",
};

function page(items: unknown[]) {
  return { items, page: 1, pageSize: 20, total: items.length };
}

describe("GoalTable", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn(() =>
      Promise.resolve(jsonResponse(200, page([NUMBER_GOAL, PERCENTAGE_GOAL, BINARY_GOAL]))),
    );
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(USER_ID_KEY, "7"); // the subordinate — all rows read-only
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders the five columns with per-type value cells", async () => {
    renderWithProviders(<GoalTable view="own" managerId={10} settingsKey="userGoals" />);

    expect(await screen.findByText("Ship four reports")).toBeInTheDocument();
    // NUMBER: plain locale numbers.
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("1.5")).toBeInTheDocument();
    // PERCENTAGE: %-suffixed.
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("45%")).toBeInTheDocument();
    // BINARY: no numeric target (em dashes), achieved pill as the current value.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText("Not achieved")).toBeInTheDocument();
    // Status badges.
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Closed")).toBeInTheDocument();
  });

  test("queries with the fixed managerId and the default -createdAt sort", async () => {
    renderWithProviders(<GoalTable view="own" managerId={10} settingsKey="userGoals" />);
    await screen.findByText("Ship four reports");

    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain("/api/v1/goals?");
    expect(url).toContain("view=own");
    expect(url).toContain("managerId=10");
    expect(url).toContain(`sort=${encodeURIComponent("-createdAt")}`);
  });

  test("the title, created-window, and status filters land in the query string and persist", async () => {
    const user = userEvent.setup();
    renderWithProviders(<GoalTable view="own" managerId={10} settingsKey="userGoals" />);
    await screen.findByText("Ship four reports");

    await user.click(screen.getByRole("button", { name: /filters/i }));
    await user.type(screen.getByLabelText("Title"), "cover");
    await waitFor(() => {
      expect(mockFetch.mock.calls.some(([u]) => String(u).includes("title=cover"))).toBe(true);
    });

    // happy-dom does not open Mantine comboboxes via userEvent's pointer simulation.
    fireEvent.click(screen.getByLabelText("Created", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "Last six months" }));
    await waitFor(() => {
      expect(
        mockFetch.mock.calls.some(([u]) => String(u).includes("createdAt%5Bgte%5D=")),
      ).toBe(true);
    });

    fireEvent.click(screen.getByLabelText("Status", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "Active" }));
    await waitFor(() => {
      expect(mockFetch.mock.calls.some(([u]) => String(u).includes("status=ACTIVE"))).toBe(true);
    });

    // Filter state persists under the embedded settings key.
    expect(localStorage.getItem("lettuce.viewSettings.userGoals.filter.title")).toContain("cover");
    expect(localStorage.getItem("lettuce.viewSettings.userGoals.filter.status")).toContain("ACTIVE");
  });

  test("clicking a column header toggles the sort param", async () => {
    const user = userEvent.setup();
    renderWithProviders(<GoalTable view="own" managerId={10} settingsKey="userGoals" />);
    await screen.findByText("Ship four reports");

    await user.click(screen.getByRole("button", { name: "Title" }));
    await waitFor(() => {
      expect(mockFetch.mock.calls.some(([u]) => String(u).includes("sort=title"))).toBe(true);
    });
    await user.click(screen.getByRole("button", { name: "Title" }));
    await waitFor(() => {
      expect(
        mockFetch.mock.calls.some(([u]) => String(u).includes(`sort=${encodeURIComponent("-title")}`)),
      ).toBe(true);
    });
  });

  test("the value columns are sortable too", async () => {
    const user = userEvent.setup();
    renderWithProviders(<GoalTable view="own" managerId={10} settingsKey="userGoals" />);
    await screen.findByText("Ship four reports");

    await user.click(screen.getByRole("button", { name: "Target" }));
    await waitFor(() => {
      expect(mockFetch.mock.calls.some(([u]) => String(u).includes("sort=targetValue"))).toBe(true);
    });
  });

  test("as the manager, DRAFT and ACTIVE rows get Edit; CLOSED rows View — with back overrides", async () => {
    localStorage.setItem(USER_ID_KEY, "10"); // Alice herself
    renderWithProviders(
      <GoalTable view="own" managerId={10} settingsKey="userGoals" backTo="/somewhere" />,
    );

    const back = encodeURIComponent("/somewhere");
    const editActive = await screen.findByRole("link", { name: "Edit goal Ship four reports" });
    expect(editActive).toHaveAttribute("href", expect.stringContaining("/goals/1/edit?from=own"));
    expect(editActive).toHaveAttribute("href", expect.stringContaining(`back=${back}`));
    expect(screen.getByRole("link", { name: "Edit goal Raise coverage" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View goal Get certified" })).toHaveAttribute(
      "href",
      expect.stringContaining("/goals/3/view?from=own"),
    );
  });

  test("as the subordinate every row is a View link", async () => {
    renderWithProviders(<GoalTable view="own" managerId={10} settingsKey="userGoals" />);

    expect(await screen.findByRole("link", { name: "View goal Ship four reports" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View goal Raise coverage" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /edit goal/i })).toBeNull();
  });

  test("shows the empty state when there are no goals", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, page([])));
    renderWithProviders(<GoalTable view="own" managerId={10} settingsKey="userGoals" />);

    expect(await screen.findByText("No goals yet.")).toBeInTheDocument();
  });

  test("shows a titled error alert when the list fails to load", async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, { title: "boom" }));
    renderWithProviders(<GoalTable view="own" managerId={10} settingsKey="userGoals" />);

    expect(await screen.findByText("Could not load goals")).toBeInTheDocument();
  });
});
