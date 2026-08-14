import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { within } from "@testing-library/react";
import { notifications } from "@mantine/notifications";
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
  dueDate: "2099-06-15",
  lastModified: new Date(2026, 6, 1).getTime(),
};

const NUMBER_GOAL = {
  ...BASE,
  id: 1,
  title: "Ship four reports",
  type: "NUMBER",
  targetValue: 4,
  currentValue: 1.5,
  milestonesDone: null,
  milestonesTotal: null,
  status: "ACTIVE",
};

const PERCENTAGE_GOAL = {
  ...BASE,
  id: 2,
  title: "Raise coverage",
  type: "PERCENTAGE",
  targetValue: 90,
  currentValue: 45,
  milestonesDone: null,
  milestonesTotal: null,
  status: "DRAFT",
};

const PLAN_GOAL = {
  ...BASE,
  id: 3,
  title: "Get certified",
  type: "PLAN",
  targetValue: null,
  currentValue: null,
  milestonesDone: 1,
  milestonesTotal: 3,
  status: "ARCHIVED",
};

function page(items: unknown[]) {
  return { items, page: 1, pageSize: 20, total: items.length };
}

describe("GoalTable", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn(() =>
      Promise.resolve(jsonResponse(200, page([NUMBER_GOAL, PERCENTAGE_GOAL, PLAN_GOAL]))),
    );
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(USER_ID_KEY, "7"); // the subordinate — all rows read-only
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders the columns with per-type value cells and the due dates", async () => {
    renderWithProviders(<GoalTable view="own" managerId={10} settingsKey="userGoals" />);

    expect(await screen.findByText("Ship four reports")).toBeInTheDocument();
    // NUMBER: plain locale numbers.
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("1.5")).toBeInTheDocument();
    // PERCENTAGE: %-suffixed.
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("45%")).toBeInTheDocument();
    // PLAN: no numeric target (em dashes), the milestone tally as the current value.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    // Status badges.
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
    // Due dates (all far-future here, so no overdue badge).
    expect(screen.getAllByText("Jun 15, 2099").length).toBe(3);
    expect(screen.queryByText("Overdue")).toBeNull();
  });

  test("a PLAN draft with no milestones yet shows an em dash, not a zero tally", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, page([{ ...PLAN_GOAL, status: "DRAFT", milestonesDone: 0, milestonesTotal: 0 }])),
    );
    renderWithProviders(<GoalTable view="own" managerId={10} settingsKey="userGoals" />);

    expect(await screen.findByText("Get certified")).toBeInTheDocument();
    expect(screen.queryByText("0 / 0")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  test("an ACTIVE goal past its due date gets the overdue badge; DRAFT and CLOSED do not", async () => {
    // Every row's due date is long past — only the ACTIVE one may signal overdue.
    mockFetch.mockResolvedValue(
      jsonResponse(
        200,
        page([
          { ...NUMBER_GOAL, dueDate: "2020-01-01" },
          { ...PERCENTAGE_GOAL, dueDate: "2020-01-01" },
          { ...PLAN_GOAL, dueDate: "2020-01-01" },
        ]),
      ),
    );
    renderWithProviders(<GoalTable view="own" managerId={10} settingsKey="userGoals" />);

    expect(await screen.findByText("Ship four reports")).toBeInTheDocument();
    expect(screen.getAllByText("Overdue").length).toBe(1);
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

  test("the unpinned own view adds the Manager column and its filter", async () => {
    const user = userEvent.setup();
    renderWithProviders(<GoalTable view="own" settingsKey="goals.own" />);
    await screen.findByText("Ship four reports");

    // Column: sortable header + chip cells.
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Manager" }));
    await waitFor(() => {
      expect(mockFetch.mock.calls.some(([u]) => String(u).includes("sort=managerName"))).toBe(true);
    });

    // Filter: lands as managerName= in the query string.
    await user.click(screen.getByRole("button", { name: /filters/i }));
    await user.type(screen.getByLabelText("Manager"), "ali");
    await waitFor(() => {
      expect(mockFetch.mock.calls.some(([u]) => String(u).includes("managerName=ali"))).toBe(true);
    });
  });

  test("a pinned manager hides the Manager column and filter (the drill-down shape)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<GoalTable view="own" managerId={10} settingsKey="userGoals" />);
    await screen.findByText("Ship four reports");

    expect(screen.queryByRole("button", { name: "Manager" })).toBeNull();
    expect(screen.queryByText("Alice")).toBeNull(); // no manager cells either
    await user.click(screen.getByRole("button", { name: /filters/i }));
    expect(screen.queryByLabelText("Manager")).toBeNull();
  });

  test("a fixed subordinateId lands in the query string (the per-subordinate drill-down)", async () => {
    renderWithProviders(
      <GoalTable view="managed" subordinateId={7} settingsKey="userGoals.managed" />,
    );
    await screen.findByText("Ship four reports");

    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain("view=managed");
    expect(url).toContain("subordinateId=7");
    expect(url).not.toContain("managerId=");
    // Pinned party → no person column (the embedding page names them in its title).
    expect(screen.queryByRole("button", { name: "Team member" })).toBeNull();
  });

  test("the unpinned managed view adds the Team member column and its filter", async () => {
    localStorage.setItem(USER_ID_KEY, "10"); // the manager's own list
    const user = userEvent.setup();
    renderWithProviders(<GoalTable view="managed" settingsKey="goals.managed" />);
    await screen.findByText("Ship four reports");

    // Column: sortable header + the subordinate's chip cells.
    expect(screen.getAllByText("Me").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Team member" }));
    await waitFor(() => {
      expect(mockFetch.mock.calls.some(([u]) => String(u).includes("sort=subordinateName"))).toBe(
        true,
      );
    });

    // Filter: lands as subordinateName= in the query string.
    await user.click(screen.getByRole("button", { name: /filters/i }));
    await user.type(screen.getByLabelText("Team member"), "me");
    await waitFor(() => {
      expect(mockFetch.mock.calls.some(([u]) => String(u).includes("subordinateName=me"))).toBe(
        true,
      );
    });
  });

  test("the person cell renders the viewer as plain You, not a chip", async () => {
    // The caller (id 7) appears as the subordinate of every row — the managed unpinned view
    // would never show self rows in practice, so probe via the own view with a self manager.
    localStorage.setItem(USER_ID_KEY, "10"); // Alice herself viewing an own list
    renderWithProviders(<GoalTable view="own" settingsKey="goals.own" />);
    await screen.findByText("Ship four reports");

    // Every manager cell is the viewer — plain "You", no avatar chip for self.
    expect(screen.getAllByText("You").length).toBeGreaterThan(0);
    expect(screen.queryByText("Alice")).toBeNull();
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

  test("the Due date column is sortable", async () => {
    const user = userEvent.setup();
    renderWithProviders(<GoalTable view="own" managerId={10} settingsKey="userGoals" />);
    await screen.findByText("Ship four reports");

    await user.click(screen.getByRole("button", { name: "Due date" }));
    await waitFor(() => {
      expect(mockFetch.mock.calls.some(([u]) => String(u).includes("sort=dueDate"))).toBe(true);
    });
    await user.click(screen.getByRole("button", { name: "Due date" }));
    await waitFor(() => {
      expect(
        mockFetch.mock.calls.some(([u]) => String(u).includes(`sort=${encodeURIComponent("-dueDate")}`)),
      ).toBe(true);
    });
  });

  test("as the manager, DRAFT rows get Edit, ACTIVE rows Lifecycle+Update, ARCHIVED rows View — with back overrides", async () => {
    localStorage.setItem(USER_ID_KEY, "10"); // Alice herself
    renderWithProviders(
      <GoalTable view="own" managerId={10} settingsKey="userGoals" backTo="/somewhere" />,
    );

    const back = encodeURIComponent("/somewhere");
    // ACTIVE (v2.8.0): the Lifecycle ▾ menu plus the Update link.
    const updateActive = await screen.findByRole("link", { name: "Update goal Ship four reports" });
    expect(updateActive).toHaveAttribute("href", expect.stringContaining("/goals/1/edit?from=own"));
    expect(updateActive).toHaveAttribute("href", expect.stringContaining(`back=${back}`));
    expect(
      screen.getByRole("button", { name: "Lifecycle actions for goal Ship four reports" }),
    ).toBeInTheDocument();
    // DRAFT: the definition editor, no lifecycle menu.
    expect(screen.getByRole("link", { name: "Edit goal Raise coverage" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lifecycle actions for goal Raise coverage" })).toBeNull();
    // ARCHIVED: view only.
    expect(screen.getByRole("link", { name: "View goal Get certified" })).toHaveAttribute(
      "href",
      expect.stringContaining("/goals/3/view?from=own"),
    );
  });

  test("as the subordinate, ACTIVE rows get Update (no lifecycle menu); the rest are View links", async () => {
    renderWithProviders(<GoalTable view="own" managerId={10} settingsKey="userGoals" />);

    // ACTIVE: progress is the pair's shared write (v2.8.0) — but the status stays manager-only.
    expect(
      await screen.findByRole("link", { name: "Update goal Ship four reports" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /lifecycle actions/i })).toBeNull();
    // DRAFT + ARCHIVED: read-only.
    expect(screen.getByRole("link", { name: "View goal Raise coverage" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View goal Get certified" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /edit goal/i })).toBeNull();
  });

  test("Return to draft from the Lifecycle menu confirms, POSTs deactivate, and toasts", async () => {
    localStorage.setItem(USER_ID_KEY, "10");
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(jsonResponse(200, page([NUMBER_GOAL, PERCENTAGE_GOAL, PLAN_GOAL])));
    });
    const toast = vi.spyOn(notifications, "show").mockReturnValue("id");
    const user = userEvent.setup();
    renderWithProviders(<GoalTable view="managed" settingsKey="goals.managed" />);

    await user.click(
      await screen.findByRole("button", { name: "Lifecycle actions for goal Ship four reports" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Return to draft" }));

    // The confirm gate: nothing fires until confirmed.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Return this goal to draft?")).toBeInTheDocument();
    expect(mockFetch.mock.calls.some(([u]) => String(u).includes("/deactivate"))).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Return to draft" }));

    await waitFor(() => {
      expect(
        mockFetch.mock.calls.some(
          ([u, init]) =>
            String(u) === "/api/v1/goals/1/deactivate" && (init as RequestInit)?.method === "POST",
        ),
      ).toBe(true);
    });
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Goal returned to draft", color: "teal" }),
    );
    toast.mockRestore();
  });

  test("Archive from the Lifecycle menu collects the summary and posts it", async () => {
    localStorage.setItem(USER_ID_KEY, "10");
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(jsonResponse(200, page([NUMBER_GOAL, PERCENTAGE_GOAL, PLAN_GOAL])));
    });
    const user = userEvent.setup();
    renderWithProviders(<GoalTable view="managed" settingsKey="goals.managed" />);

    await user.click(
      await screen.findByRole("button", { name: "Lifecycle actions for goal Ship four reports" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Archive goal" }));
    const dialog = await screen.findByRole("dialog");

    // Blank summary is blocked client-side (the GoalCloseModal rule).
    await user.click(within(dialog).getByRole("button", { name: "Archive goal" }));
    expect(
      await within(dialog).findByText("A summary is required to archive a goal"),
    ).toBeInTheDocument();
    expect(mockFetch.mock.calls.some(([u]) => String(u).includes("/archive"))).toBe(false);

    await user.type(within(dialog).getByLabelText(/summary/i), "Shipped all four");
    await user.click(within(dialog).getByRole("button", { name: "Archive goal" }));

    await waitFor(() => {
      const call = mockFetch.mock.calls.find(([u]) => String(u) === "/api/v1/goals/1/archive");
      expect(call).toBeDefined();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
        summary: "Shipped all four",
      });
    });
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
