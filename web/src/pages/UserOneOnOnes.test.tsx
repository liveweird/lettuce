import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import UserOneOnOnes from "./UserOneOnOnes";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

// A 1:1 I (#7) ran with Alice (#10) — I get an Edit action.
const MINE_ITEM = {
  id: 11,
  managerId: 7,
  managerName: "Me",
  managerDeleted: false,
  subordinateId: 10,
  subordinateName: "Alice",
  subordinateDeleted: false,
  meetingDate: "2026-07-05",
  lastModified: 1752000000000,
  pointCount: 2,
  decisionCount: 1,
  actionItemCount: 0,
  openActionItemCount: 0,
};

// A historic 1:1 Alice (#10) ran with me (#7), from before we swapped roles — View only.
const THEIRS_ITEM = {
  id: 12,
  managerId: 10,
  managerName: "Alice",
  managerDeleted: false,
  subordinateId: 7,
  subordinateName: "Me",
  subordinateDeleted: false,
  meetingDate: "2026-01-10",
  lastModified: 1740000000000,
  pointCount: 1,
  decisionCount: 0,
  actionItemCount: 1,
  openActionItemCount: 1,
};

function page(items: unknown[]) {
  return { items, page: 1, pageSize: 20, total: items.length };
}

function renderScreen(path = "/users/10/one-on-ones?name=Alice&from=managers") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/users/:userId/one-on-ones" element={<UserOneOnOnes />} />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("UserOneOnOnes page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn((url: string) => {
      if (String(url).includes("/api/v1/one-on-ones?")) {
        return Promise.resolve(jsonResponse(200, page([MINE_ITEM, THEIRS_ITEM])));
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

  test("renders the title and queries view=with scoped to the counterpart, without a filter panel", async () => {
    renderScreen();

    expect(await screen.findByText("1:1 meetings with Alice")).toBeInTheDocument();
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([u]) => String(u));
      expect(urls.some((u) => u.includes("view=with") && u.includes("counterpartId=10"))).toBe(true);
    });
    expect(screen.queryByRole("button", { name: /filters/i })).toBeNull();
  });

  test("rows I ran get an Edit link, theirs a View link, both returning here", async () => {
    renderScreen();

    const back = encodeURIComponent("/users/10/one-on-ones?name=Alice&from=managers");

    const editLink = await screen.findByRole("link", { name: "Edit the 1:1 with Alice" });
    expect(editLink).toHaveAttribute("href", expect.stringContaining("/one-on-ones/11/edit?from=with"));
    expect(editLink).toHaveAttribute("href", expect.stringContaining(`back=${back}`));

    const viewLink = screen.getByRole("link", { name: "View the 1:1 with Alice" });
    expect(viewLink).toHaveAttribute("href", expect.stringContaining("/one-on-ones/12/view?from=with"));
    expect(viewLink).toHaveAttribute("href", expect.stringContaining(`back=${back}`));
  });

  test("mode=audit with the HR role renders the auditor view (view=user)", async () => {
    localStorage.setItem(ROLE_KEY, JSON.stringify(["HR"]));
    renderScreen("/users/10/one-on-ones?name=Alice&from=details&mode=audit");

    expect(await screen.findByText("All 1:1 meetings of Alice")).toBeInTheDocument();
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([u]) => String(u));
      expect(urls.some((u) => u.includes("view=user") && u.includes("userId=10"))).toBe(true);
    });
    // Read-only: never a "New 1:1" in audit mode; the back link returns to the details page.
    expect(screen.queryByRole("link", { name: /new 1:1/i })).toBeNull();
    expect(screen.getByRole("link", { name: /back to user details/i })).toHaveAttribute(
      "href",
      "/users/10/details?name=Alice",
    );
  });

  test("mode=audit without an auditor role silently falls back to the pair view", async () => {
    renderScreen("/users/10/one-on-ones?name=Alice&from=managers&mode=audit");

    expect(await screen.findByText("1:1 meetings with Alice")).toBeInTheDocument();
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([u]) => String(u));
      expect(urls.some((u) => u.includes("view=with") && u.includes("counterpartId=10"))).toBe(true);
      expect(urls.some((u) => u.includes("view=user"))).toBe(false);
    });
  });

  test("an invalid user id redirects back to the managers tab", () => {
    renderScreen("/users/abc/one-on-ones");
    expect(screen.getByTestId("probe")).toHaveTextContent("/?tab=managers");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("falls back to a placeholder name when none is provided", async () => {
    renderScreen("/users/10/one-on-ones");
    expect(await screen.findByText("1:1 meetings with user #10")).toBeInTheDocument();
  });

  test("the Back to My managers link points at the managers tab", async () => {
    renderScreen();
    expect(
      await screen.findByRole("link", { name: /back to my managers/i }),
    ).toHaveAttribute("href", "/?tab=managers");
  });

  test("from=subordinates shows a Back to My subordinates link and an invalid id returns there", async () => {
    renderScreen("/users/10/one-on-ones?name=Alice&from=subordinates");
    expect(
      await screen.findByRole("link", { name: /back to my subordinates/i }),
    ).toHaveAttribute("href", "/?tab=subordinates");

    renderScreen("/users/abc/one-on-ones?from=subordinates");
    expect(screen.getByTestId("probe")).toHaveTextContent("/?tab=subordinates");
  });

  test("from=subordinates offers New 1:1 with the person preselected; from=managers does not", async () => {
    renderScreen("/users/10/one-on-ones?name=Alice&from=subordinates");
    const back = encodeURIComponent("/users/10/one-on-ones?name=Alice&from=subordinates");
    expect(await screen.findByRole("link", { name: "New 1:1" })).toHaveAttribute(
      "href",
      `/one-on-ones/new?subordinateId=10&subordinateName=Alice&back=${back}`,
    );

    // Reached from the managers card, the counterpart is the caller's own manager — a 1:1
    // can only be created with a direct report, so no button.
    cleanup();
    renderScreen();
    await screen.findByRole("link", { name: /back to my managers/i });
    expect(screen.queryByRole("link", { name: "New 1:1" })).toBeNull();
  });

  test("from=team returns to the team view and offers New 1:1 with the team origin preserved", async () => {
    renderScreen("/users/10/one-on-ones?name=Alice&from=team&teamId=5");

    expect(await screen.findByRole("link", { name: /back to team subordinates/i })).toHaveAttribute(
      "href",
      "/teams/5/details",
    );
    const back = encodeURIComponent("/users/10/one-on-ones?name=Alice&from=team&teamId=5");
    expect(screen.getByRole("link", { name: "New 1:1" })).toHaveAttribute(
      "href",
      `/one-on-ones/new?subordinateId=10&subordinateName=Alice&back=${back}`,
    );
  });

  test("from=team without a valid teamId degrades to the managers origin", async () => {
    renderScreen("/users/10/one-on-ones?name=Alice&from=team");
    expect(
      await screen.findByRole("link", { name: /back to my managers/i }),
    ).toHaveAttribute("href", "/?tab=managers");
    expect(screen.queryByRole("link", { name: "New 1:1" })).toBeNull();
  });
});
