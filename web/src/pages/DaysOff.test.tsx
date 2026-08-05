import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/render";
import { jsonResponse } from "../test/http";
import DaysOff from "./DaysOff";

type FetchMock = ReturnType<typeof vi.fn>;

const CALENDAR = {
  month: "2026-08",
  holidays: [],
  users: [
    { userId: 5, userName: "Me Myself", userDeleted: false, entries: [] },
    { userId: 6, userName: "Mate Person", userDeleted: false, entries: [] },
  ],
};

const BUDGET = {
  userId: 5,
  userName: "Me Myself",
  userDeleted: false,
  year: new Date().getFullYear(),
  allowance: 20,
  carriedOver: 2,
  corrected: 0,
  reserved: 1.5,
  used: 3,
  remaining: 17.5,
};

describe("DaysOff page", () => {
  let mockFetch: FetchMock;

  function setupMocks({ managed = 0 }: { managed?: number } = {}) {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/api/v1/teams?")) {
        return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 1, total: managed }));
      }
      if (u.includes("/api/v1/days-off/calendar")) {
        return Promise.resolve(jsonResponse(200, CALENDAR));
      }
      if (u.includes("/api/v1/days-off/budgets")) {
        return Promise.resolve(jsonResponse(200, { items: [BUDGET] }));
      }
      if (u.includes("/api/v1/days-off")) {
        return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
      }
      return Promise.resolve(jsonResponse(200, { items: [] }));
    });
  }

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.userId", "5");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("defaults to the calendar tab and hides the team tab and scope picker for non-managers", async () => {
    setupMocks({ managed: 0 });
    renderWithProviders(<DaysOff />, { route: "/days-off" });

    expect(await screen.findByRole("table", { name: "Team days-off calendar" })).toBeInTheDocument();
    expect(screen.getByText("Mate Person")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "My team" })).toBeNull();
    expect(screen.queryAllByLabelText("Whose calendar")).toHaveLength(0);
    // The month pager is there.
    expect(screen.getByLabelText("Previous month")).toBeInTheDocument();
    expect(screen.getByLabelText("Next month")).toBeInTheDocument();
  });

  test("managers get the scope picker and the team tab with budgets", async () => {
    setupMocks({ managed: 1 });
    renderWithProviders(<DaysOff />, { route: "/days-off" });

    expect(await screen.findByRole("tab", { name: "My team" })).toBeInTheDocument();
    // Mantine associates both the label and the input with the text — any match will do.
    await waitFor(() => expect(screen.getAllByLabelText("Whose calendar").length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole("tab", { name: "My team" }));
    expect(await screen.findByText("Paid-days budgets")).toBeInTheDocument();
  });

  test("the requests tab shows the budget card and the New request button", async () => {
    setupMocks();
    renderWithProviders(<DaysOff />, { route: "/days-off?tab=requests" });

    expect(await screen.findByText(`Your paid days off in ${BUDGET.year}`)).toBeInTheDocument();
    expect(await screen.findByText("17.5")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New request" })).toHaveAttribute(
      "href",
      expect.stringContaining("/days-off/new"),
    );
  });

  test("a non-manager's deep link to the team tab falls back to the calendar", async () => {
    setupMocks({ managed: 0 });
    renderWithProviders(<DaysOff />, { route: "/days-off?tab=team" });
    expect(await screen.findByRole("table", { name: "Team days-off calendar" })).toBeInTheDocument();
    expect(screen.queryByText("Paid-days budgets")).toBeNull();
  });

  test("the month pager steps the calendar query", async () => {
    setupMocks();
    renderWithProviders(<DaysOff />, { route: "/days-off" });
    await screen.findByRole("table", { name: "Team days-off calendar" });

    await userEvent.click(screen.getByLabelText("Next month"));
    await waitFor(() => {
      const months = mockFetch.mock.calls
        .map(([u]) => String(u))
        .filter((u) => u.includes("/calendar"))
        .map((u) => new URL(u, "http://x").searchParams.get("month"));
      expect(new Set(months).size).toBe(2); // the initial month and the stepped one
    });
  });
});
