import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import UserGoals from "./UserGoals";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

// A goal my manager Alice (#10) set for me (#7) — from this screen I'm always the subordinate.
const GOAL_ITEM = {
  id: 21,
  managerId: 10,
  managerName: "Alice",
  managerDeleted: false,
  subordinateId: 7,
  subordinateName: "Me",
  subordinateDeleted: false,
  title: "Ship the reporting module",
  type: "NUMBER",
  targetValue: 4,
  currentValue: 1,
  achieved: null,
  status: "ACTIVE",
  createdAt: new Date(2026, 5, 1).getTime(),
  dueDate: "2099-06-15",
  lastModified: new Date(2026, 6, 1).getTime(),
};

function page(items: unknown[]) {
  return { items, page: 1, pageSize: 20, total: items.length };
}

function renderScreen(path = "/users/10/goals?name=Alice&from=managers") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/users/:userId/goals" element={<UserGoals />} />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("UserGoals page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn((url: string) => {
      if (String(url).includes("/api/v1/goals?")) {
        return Promise.resolve(jsonResponse(200, page([GOAL_ITEM])));
      }
      return Promise.resolve(jsonResponse(200, page([])));
    });
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders the title and queries view=own scoped to the manager's id", async () => {
    renderScreen();

    expect(await screen.findByText("Goals from Alice")).toBeInTheDocument();
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([u]) => String(u));
      expect(urls.some((u) => u.includes("view=own") && u.includes("managerId=10"))).toBe(true);
    });
  });

  test("rows link to the goal view (I'm the subordinate, never the editor), returning here", async () => {
    renderScreen();

    const back = encodeURIComponent("/users/10/goals?name=Alice&from=managers");
    const viewLink = await screen.findByRole("link", { name: "View goal Ship the reporting module" });
    expect(viewLink).toHaveAttribute("href", expect.stringContaining("/goals/21/view?from=own"));
    expect(viewLink).toHaveAttribute("href", expect.stringContaining(`back=${back}`));
  });

  test("mode=audit with the HR role renders the auditor view (view=user)", async () => {
    localStorage.setItem(ROLE_KEY, JSON.stringify(["HR"]));
    renderScreen("/users/10/goals?name=Alice&from=details&mode=audit");

    expect(await screen.findByText("All goals of Alice")).toBeInTheDocument();
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([u]) => String(u));
      expect(urls.some((u) => u.includes("view=user") && u.includes("userId=10"))).toBe(true);
    });
    expect(screen.queryByRole("link", { name: /new goal/i })).toBeNull();
  });

  test("mode=audit with only the ADMIN role falls back to the origin view (HR-only since v1.26.0)", async () => {
    localStorage.setItem(ROLE_KEY, JSON.stringify(["ADMIN"]));
    renderScreen("/users/10/goals?name=Alice&from=managers&mode=audit");

    expect(await screen.findByText("Goals from Alice")).toBeInTheDocument();
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([u]) => String(u));
      expect(urls.some((u) => u.includes("view=own") && u.includes("managerId=10"))).toBe(true);
      expect(urls.some((u) => u.includes("view=user"))).toBe(false);
    });
  });

  test("mode=audit without an auditor role silently falls back to the origin view", async () => {
    renderScreen("/users/10/goals?name=Alice&from=managers&mode=audit");

    expect(await screen.findByText("Goals from Alice")).toBeInTheDocument();
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([u]) => String(u));
      expect(urls.some((u) => u.includes("view=own") && u.includes("managerId=10"))).toBe(true);
      expect(urls.some((u) => u.includes("view=user"))).toBe(false);
    });
  });

  test("an invalid user id redirects back to the managers tab", () => {
    renderScreen("/users/abc/goals");
    expect(screen.getByTestId("probe")).toHaveTextContent("/?tab=managers");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("falls back to a placeholder name when none is provided", async () => {
    renderScreen("/users/10/goals");
    expect(await screen.findByText("Goals from user #10")).toBeInTheDocument();
  });

  test("the Back to My managers link points at the managers tab", async () => {
    renderScreen();
    expect(
      await screen.findByRole("link", { name: /back to my managers/i }),
    ).toHaveAttribute("href", "/?tab=managers");
  });

  test("the managers origin offers no New goal button", async () => {
    renderScreen();
    await screen.findByText("Goals from Alice");
    expect(screen.queryByRole("link", { name: "New goal" })).toBeNull();
  });

  test("from=subordinates flips the direction: managed view scoped to the subordinate", async () => {
    renderScreen("/users/10/goals?name=Bob&from=subordinates");

    expect(await screen.findByText("Goals for Bob")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /back to my subordinates/i }),
    ).toHaveAttribute("href", "/?tab=subordinates");
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([u]) => String(u));
      expect(urls.some((u) => u.includes("view=managed") && u.includes("subordinateId=10"))).toBe(
        true,
      );
    });
  });

  test("from=subordinates offers New goal with the person preselected, returning here", async () => {
    renderScreen("/users/10/goals?name=Bob&from=subordinates");

    const back = encodeURIComponent("/users/10/goals?name=Bob&from=subordinates");
    expect(await screen.findByRole("link", { name: "New goal" })).toHaveAttribute(
      "href",
      `/goals/new?subordinateId=10&subordinateName=Bob&back=${back}`,
    );
  });

  test("from=details with back= and manages=1: returns to the given URL and keeps New goal", async () => {
    // The details-page round-trip (v1.39.0): `back` overrides the destination (the details
    // page with ITS origin intact), the label stays the details origin's, and `manages=1`
    // preserves the manager-only affordances the origin alone can't prove.
    const detailsUrl = "/users/10/details?name=Bob&from=members&teamId=3";
    renderScreen(
      `/users/10/goals?name=Bob&from=details&back=${encodeURIComponent(detailsUrl)}&manages=1`,
    );

    expect(await screen.findByRole("link", { name: /back to user details/i })).toHaveAttribute(
      "href",
      detailsUrl,
    );
    // manages=1 → the managed direction with the New-goal affordance; the round-trip back
    // URL it hands to the create screen preserves back + manages.
    const back = encodeURIComponent(
      `/users/10/goals?name=Bob&from=details&back=${encodeURIComponent(detailsUrl)}&manages=1`,
    );
    expect(await screen.findByRole("link", { name: "New goal" })).toHaveAttribute(
      "href",
      `/goals/new?subordinateId=10&subordinateName=Bob&back=${back}`,
    );
  });

  test("an invalid id under the subordinates origin returns to its tab", () => {
    renderScreen("/users/abc/goals?from=subordinates");
    expect(screen.getByTestId("probe")).toHaveTextContent("/?tab=subordinates");
  });

  test("from=team behaves like the manager side and returns to the team view", async () => {
    renderScreen("/users/10/goals?name=Bob&from=team&teamId=5");

    expect(await screen.findByText("Goals for Bob")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to team subordinates/i })).toHaveAttribute(
      "href",
      "/teams/5/subordinates",
    );
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([u]) => String(u));
      expect(urls.some((u) => u.includes("view=managed") && u.includes("subordinateId=10"))).toBe(
        true,
      );
    });
    // New goal is offered, and its back target preserves the team origin for the round-trip.
    const back = encodeURIComponent("/users/10/goals?name=Bob&from=team&teamId=5");
    expect(screen.getByRole("link", { name: "New goal" })).toHaveAttribute(
      "href",
      `/goals/new?subordinateId=10&subordinateName=Bob&back=${back}`,
    );
  });

  test("from=team without a valid teamId degrades to the managers origin", async () => {
    renderScreen("/users/10/goals?name=Alice&from=team");

    expect(await screen.findByText("Goals from Alice")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /back to my managers/i }),
    ).toHaveAttribute("href", "/?tab=managers");
    expect(screen.queryByRole("link", { name: "New goal" })).toBeNull();
  });
});
