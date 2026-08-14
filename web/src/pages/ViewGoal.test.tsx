import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import ViewGoal from "./ViewGoal";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

const GOAL = {
  id: 5,
  managerId: 7,
  managerName: "Mona Manager",
  subordinateId: 8,
  subordinateName: "Sub Ordinate",
  createdAt: new Date(2026, 5, 1).getTime(),
  dueDate: "2099-06-15",
  title: "Raise coverage",
  description: "Get the suite green **and keep it there**",
  type: "PERCENTAGE",
  targetValue: 90,
  currentValue: 45,
  achieved: null,
  status: "ACTIVE",
  summary: null,
  lastModified: new Date(2026, 6, 1).getTime(),
};

function renderScreen(path = "/goals/5/view?from=own&back=%2Fusers%2F7%2Fgoals") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/goals/:id/view" element={<ViewGoal />} />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("ViewGoal page", () => {
  let mockFetch: FetchMock;

  function setupMocks(goal: unknown = GOAL) {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "POST") return Promise.resolve(new Response(null, { status: 204 }));
      if (u.includes("/events")) return Promise.resolve(jsonResponse(200, { items: [] }));
      if (u.includes("/api/v1/goals/5")) return Promise.resolve(jsonResponse(200, goal));
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    });
  }

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(USER_ID_KEY, "8"); // the subordinate by default
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders the document: parties, type, title, markdown description, percentage progress", async () => {
    setupMocks();
    renderScreen();

    expect(await screen.findByText("Raise coverage")).toBeInTheDocument();
    expect(screen.getByText("Mona Manager")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument(); // the subordinate is the viewer
    expect(screen.getByText("Percentage")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    // Markdown renders (the bold run becomes its own node).
    expect(screen.getByText("and keep it there")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("45% of the 90% target")).toBeInTheDocument();
    // The due date is far in the future — shown, but not flagged.
    expect(screen.getByText("Due date")).toBeInTheDocument();
    expect(screen.getByText("Jun 15, 2099")).toBeInTheDocument();
    expect(screen.queryByText("Overdue")).toBeNull();
    // No summary section while the goal was never closed.
    expect(screen.queryByText("Summary")).toBeNull();
  });

  test("an ACTIVE goal past its due date shows the overdue badge; an ARCHIVED one does not", async () => {
    setupMocks({ ...GOAL, dueDate: "2020-01-01" });
    renderScreen();

    expect(await screen.findByText("Jan 1, 2020")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();

    cleanup();
    setupMocks({ ...GOAL, dueDate: "2020-01-01", status: "ARCHIVED", summary: "done" });
    renderScreen();
    expect(await screen.findByText("Jan 1, 2020")).toBeInTheDocument();
    expect(screen.queryByText("Overdue")).toBeNull();
  });

  test("an archived goal shows its summary pre-wrapped and the achieved pill for BINARY", async () => {
    setupMocks({
      ...GOAL,
      type: "BINARY",
      targetValue: null,
      currentValue: null,
      achieved: true,
      status: "ARCHIVED",
      summary: "Done well.\nSecond line.",
    });
    renderScreen();

    expect(await screen.findByText("Achieved")).toBeInTheDocument();
    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(screen.getByText(/Done well\./)).toBeInTheDocument();
  });

  test("the subordinate gets no lifecycle actions and no Edit — but Update on ACTIVE (v2.8.0)", async () => {
    setupMocks();
    renderScreen();

    await screen.findByText("Raise coverage");
    expect(screen.queryByRole("button", { name: /^activate$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /archive goal/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^edit$/i })).toBeNull();
    // Progress is the pair's shared write: the subordinate reaches the Update screen.
    expect(screen.getByRole("link", { name: /^update$/i })).toHaveAttribute(
      "href",
      expect.stringContaining("/goals/5/edit?from=own"),
    );
    // Close (the back link) is always there.
    expect(screen.getByRole("link", { name: /^close$/i })).toHaveAttribute("href", "/users/7/goals");
  });

  test("the subordinate gets no Update on a non-ACTIVE goal", async () => {
    setupMocks({ ...GOAL, status: "ARCHIVED", summary: "done" });
    renderScreen();

    await screen.findByText("Raise coverage");
    expect(screen.queryByRole("link", { name: /^update$/i })).toBeNull();
  });

  test("the manager sees per-status actions: Activate on DRAFT", async () => {
    localStorage.setItem(USER_ID_KEY, "7");
    setupMocks({ ...GOAL, status: "DRAFT" });
    renderScreen();

    expect(await screen.findByRole("button", { name: /^activate$/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^edit$/i })).toHaveAttribute(
      "href",
      expect.stringContaining("/goals/5/edit?from=own"),
    );
  });

  test("the manager on ACTIVE sees Return to draft + Archive goal + Update; deactivate confirms, then fires and navigates back", async () => {
    localStorage.setItem(USER_ID_KEY, "7");
    setupMocks();
    const toast = vi.spyOn(notifications, "show").mockReturnValue("id");
    const user = userEvent.setup();
    renderScreen();

    // The manager's ACTIVE affordances: Update (progress) + the two lifecycle exits.
    expect(await screen.findByRole("link", { name: /^update$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /return to draft/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /return to draft/i }));

    // Return-to-draft asks first (v2.8.0) — nothing fires until confirmed.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Return this goal to draft?")).toBeInTheDocument();
    expect(mockFetch.mock.calls.some(([u]) => String(u).includes("/deactivate"))).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: /return to draft/i }));

    await waitFor(() => {
      expect(
        mockFetch.mock.calls.some(
          ([u, init]) =>
            String(u) === "/api/v1/goals/5/deactivate" && (init as RequestInit)?.method === "POST",
        ),
      ).toBe(true);
    });
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/users/7/goals"));
    // The success toast fires with the action-specific message (fixed vocabulary, no data).
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Goal returned to draft", color: "teal" }),
    );
    toast.mockRestore();
  });

  test("cancelling the deactivate confirm fires nothing", async () => {
    localStorage.setItem(USER_ID_KEY, "7");
    setupMocks();
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole("button", { name: /return to draft/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockFetch.mock.calls.some(([u]) => String(u).includes("/deactivate"))).toBe(false);
  });

  test("a running deactivate spins the confirm button while the footer stays blocked", async () => {
    localStorage.setItem(USER_ID_KEY, "7");
    setupMocks();
    // Keep the deactivate POST pending so the in-flight state is observable.
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "POST") return new Promise<Response>(() => {});
      if (u.includes("/events")) return Promise.resolve(jsonResponse(200, { items: [] }));
      if (u.includes("/api/v1/goals/5")) return Promise.resolve(jsonResponse(200, GOAL));
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    });
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole("button", { name: /return to draft/i }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: /return to draft/i });
    await user.click(confirm);

    await waitFor(() => expect(confirm).toHaveAttribute("data-loading", "true"));
    const close = screen.getByRole("button", { name: /archive goal/i });
    expect(close).not.toHaveAttribute("data-loading");
    expect(close).toBeDisabled(); // still blocked from double-firing, just not spinning
  });

  test("archiving requires a summary in the modal and posts it", async () => {
    localStorage.setItem(USER_ID_KEY, "7");
    setupMocks();
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole("button", { name: /archive goal/i }));
    const dialog = await screen.findByRole("dialog");

    // Blank summary is blocked client-side.
    await user.click(within(dialog).getByRole("button", { name: /archive goal/i }));
    expect(await within(dialog).findByText("A summary is required to archive a goal")).toBeInTheDocument();
    expect(
      mockFetch.mock.calls.some(([u]) => String(u).includes("/archive")),
    ).toBe(false);

    await user.type(within(dialog).getByLabelText(/summary/i), "Target reached early");
    await user.click(within(dialog).getByRole("button", { name: /archive goal/i }));

    await waitFor(() => {
      const call = mockFetch.mock.calls.find(([u]) => String(u) === "/api/v1/goals/5/archive");
      expect(call).toBeDefined();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
        summary: "Target reached early",
      });
    });
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/users/7/goals"));
  });

  test("a 409 on an action renders the invalid-transition message and stays", async () => {
    localStorage.setItem(USER_ID_KEY, "7");
    setupMocks({ ...GOAL, status: "ARCHIVED", summary: "old" });
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if ((init?.method ?? "GET") === "POST") {
        return Promise.resolve(jsonResponse(409, { title: "conflict" }));
      }
      if (u.includes("/events")) return Promise.resolve(jsonResponse(200, { items: [] }));
      return Promise.resolve(jsonResponse(200, { ...GOAL, status: "ARCHIVED", summary: "old" }));
    });
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole("button", { name: /reopen/i }));
    expect(
      await screen.findByText("This action is not available in the goal's current status."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).toBeNull(); // still on the view
  });

  test("load errors map to the right message", async () => {
    mockFetch.mockResolvedValue(jsonResponse(404, { title: "nope" }));
    renderScreen();
    expect(await screen.findByText("This goal does not exist or was deleted.")).toBeInTheDocument();

    cleanup();
    mockFetch.mockResolvedValue(jsonResponse(403, { title: "nope" }));
    renderScreen();
    expect(await screen.findByText("You may not view this goal.")).toBeInTheDocument();
  });
});
