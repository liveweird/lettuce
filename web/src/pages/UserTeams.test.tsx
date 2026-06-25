import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import UserTeams from "./UserTeams";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type TeamItem = {
  id: number;
  name: string;
  managerId: number;
  managerName: string;
  managerDeleted?: boolean;
};

function teamsPage(items: TeamItem[]) {
  return jsonResponse(200, {
    items: items.map((t) => ({ managerDeleted: false, ...t })),
    page: 1,
    pageSize: 100,
    total: items.length,
  });
}

const TARGET_USER = { id: 7, name: "Alice", email: "alice@example.com", role: "USER" as const };

// Team 1: Alice is already a member. Team 2: not a member (candidate). Team 3: Alice manages it.
const MEMBER_TEAMS: TeamItem[] = [
  { id: 1, name: "Platform", managerId: 10, managerName: "Mona Manager" },
];
const ALL_TEAMS: TeamItem[] = [
  { id: 1, name: "Platform", managerId: 10, managerName: "Mona Manager" },
  { id: 2, name: "Mobile", managerId: 11, managerName: "Bob Manager" },
  { id: 3, name: "Solo", managerId: 7, managerName: "Alice" },
];

function isMembersUrl(url: string) {
  return url.startsWith("/api/teams?") && url.includes("memberId=7");
}
function isAllTeamsUrl(url: string) {
  return url.startsWith("/api/teams?") && !url.includes("memberId=");
}

function renderUserTeams(id: number | string = 7, search = "") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/users/${id}/teams${search}`]}>
          <Routes>
            <Route path="/users/:id/teams" element={<UserTeams />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("UserTeams page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "ADMIN");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders heading and the user's member teams, querying by memberId", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/users/7") return Promise.resolve(jsonResponse(200, TARGET_USER));
      if (isMembersUrl(url)) return Promise.resolve(teamsPage(MEMBER_TEAMS));
      if (isAllTeamsUrl(url)) return Promise.resolve(teamsPage(ALL_TEAMS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    renderUserTeams(7);

    expect(await screen.findByRole("heading", { name: "Teams — Alice" })).toBeInTheDocument();
    expect(await screen.findByRole("cell", { name: "Platform" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Mona Manager" })).toBeInTheDocument();

    const membersCall = mockFetch.mock.calls.find(([u]) => typeof u === "string" && isMembersUrl(u));
    expect(membersCall).toBeDefined();
  });

  test("non-admin gets a read-only list: no add picker, no remove buttons", async () => {
    localStorage.setItem(ROLE_KEY, "USER");
    mockFetch.mockImplementation((url: string) => {
      if (isMembersUrl(url)) return Promise.resolve(teamsPage(MEMBER_TEAMS));
      // getUser (self-or-admin) and the all-teams pool must not be fetched for non-admins.
      if (url === "/api/users/7") return Promise.resolve(jsonResponse(403, {}));
      if (isAllTeamsUrl(url)) return Promise.resolve(teamsPage(ALL_TEAMS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    // The user's name comes from the ?name= param the /users list passes.
    renderUserTeams(7, "?name=Alice");

    // Not redirected: heading (from the name param) and the team rows render.
    expect(await screen.findByRole("heading", { name: "Teams — Alice" })).toBeInTheDocument();
    expect(await screen.findByRole("cell", { name: "Platform" })).toBeInTheDocument();

    // No management controls.
    expect(screen.queryByLabelText("Add to team")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^remove from /i })).not.toBeInTheDocument();

    // Neither getUser nor the all-teams pool was requested.
    expect(mockFetch.mock.calls.some(([u]) => u === "/api/users/7")).toBe(false);
    expect(mockFetch.mock.calls.some(([u]) => typeof u === "string" && isAllTeamsUrl(u))).toBe(false);
  });

  test("add picker excludes joined and self-managed teams, and PUTs the membership", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "PUT" && url === "/api/teams/2/members/7") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url === "/api/users/7") return Promise.resolve(jsonResponse(200, TARGET_USER));
      if (isMembersUrl(url)) return Promise.resolve(teamsPage(MEMBER_TEAMS));
      if (isAllTeamsUrl(url)) return Promise.resolve(teamsPage(ALL_TEAMS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderUserTeams(7);

    await screen.findByRole("cell", { name: "Platform" });

    await user.click(screen.getByPlaceholderText("Pick a team"));
    // happy-dom marks the portaled dropdown as hidden, so query with hidden:true.
    const listbox = await screen.findByRole("listbox", { hidden: true });
    const optionLabels = within(listbox)
      .getAllByRole("option", { hidden: true })
      .map((o) => o.textContent);
    // Only "Mobile" is offered: "Platform" (already joined) and "Solo" (self-managed) are excluded.
    expect(optionLabels).toEqual(["Mobile"]);

    await user.click(within(listbox).getByText("Mobile"));
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(
        ([u, init]) =>
          (init as RequestInit | undefined)?.method === "PUT" && u === "/api/teams/2/members/7",
      );
      expect(putCall).toBeDefined();
    });
  });

  test("remove asks for confirmation then DELETEs and drops the row", async () => {
    let membersCount = 0;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE" && url === "/api/teams/1/members/7") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url === "/api/users/7") return Promise.resolve(jsonResponse(200, TARGET_USER));
      if (isMembersUrl(url)) {
        membersCount++;
        return Promise.resolve(teamsPage(membersCount === 1 ? MEMBER_TEAMS : []));
      }
      if (isAllTeamsUrl(url)) return Promise.resolve(teamsPage(ALL_TEAMS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderUserTeams(7);

    await user.click(await screen.findByRole("button", { name: /remove from platform/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^remove$/i }));

    await waitFor(() =>
      expect(screen.queryByRole("cell", { name: "Platform" })).not.toBeInTheDocument(),
    );
    const deleteCall = mockFetch.mock.calls.find(
      ([u, init]) =>
        (init as RequestInit | undefined)?.method === "DELETE" && u === "/api/teams/1/members/7",
    );
    expect(deleteCall).toBeDefined();
  });

  test("shows the empty state when the user belongs to no teams", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/users/7") return Promise.resolve(jsonResponse(200, TARGET_USER));
      if (isMembersUrl(url)) return Promise.resolve(teamsPage([]));
      if (isAllTeamsUrl(url)) return Promise.resolve(teamsPage(ALL_TEAMS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    renderUserTeams(7);

    expect(await screen.findByText(/not a member of any team/i)).toBeInTheDocument();
  });

  test("surfaces an alert when adding to a team fails", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "PUT" && url === "/api/teams/2/members/7") {
        return Promise.resolve(jsonResponse(400, { error: "bad_request", message: "nope" }));
      }
      if (url === "/api/users/7") return Promise.resolve(jsonResponse(200, TARGET_USER));
      if (isMembersUrl(url)) return Promise.resolve(teamsPage(MEMBER_TEAMS));
      if (isAllTeamsUrl(url)) return Promise.resolve(teamsPage(ALL_TEAMS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderUserTeams(7);

    await screen.findByRole("cell", { name: "Platform" });
    await user.click(screen.getByPlaceholderText("Pick a team"));
    const listbox = await screen.findByRole("listbox", { hidden: true });
    await user.click(within(listbox).getByText("Mobile"));
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(await screen.findByText(/failed to add to team/i)).toBeInTheDocument();
  });
});
