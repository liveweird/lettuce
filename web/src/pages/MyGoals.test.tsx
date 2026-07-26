import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "../test/render";
import MyGoals from "./MyGoals";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

// Goals from two different managers — the whole point of the cross-manager list.
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
  achieved: null,
  status: "ACTIVE",
  createdAt: new Date(2026, 5, 1).getTime(),
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

describe("MyGoals page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { items: [FROM_ALICE, FROM_BOB], page: 1, pageSize: 20, total: 2 })),
    );
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("lists all own goals with the Manager column, unscoped to any manager", async () => {
    renderWithProviders(<MyGoals />);

    expect(await screen.findByText("My goals")).toBeInTheDocument();
    // Wait for the rows, not just the title (the heading renders before the data arrives).
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manager" })).toBeInTheDocument(); // sortable header

    await waitFor(() => {
      const url = String(mockFetch.mock.calls[0][0]);
      expect(url).toContain("view=own");
      expect(url).not.toContain("managerId=");
    });
  });

  test("row links carry no back override — the detail pages already default to /goals", async () => {
    renderWithProviders(<MyGoals />);

    const view = await screen.findByRole("link", { name: "View goal Ship four reports" });
    expect(view).toHaveAttribute("href", expect.stringContaining("from=own"));
    expect(view.getAttribute("href")).not.toContain("back=");
  });
});
