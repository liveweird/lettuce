import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TeamMembers from "./TeamMembers";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type UserItem = { id: number; name: string; email: string; role: "ADMIN" | "USER" };

function usersPage(items: UserItem[]) {
  return jsonResponse(200, { items, page: 1, pageSize: 100, total: items.length });
}

// Team 3 is managed by user 10; its members are users 1 and 2.
const TEAM = { id: 3, name: "Platform", managerId: 10, memberIds: [1, 2] };
const MEMBERS: UserItem[] = [
  { id: 1, name: "Carol", email: "carol@example.com", role: "USER" },
  { id: 2, name: "Dave", email: "dave@example.com", role: "USER" },
];
const ALL_USERS: UserItem[] = [
  ...MEMBERS,
  { id: 9, name: "Erin", email: "erin@example.com", role: "USER" },
  { id: 10, name: "Mona Manager", email: "mona@example.com", role: "ADMIN" },
];

function isMembersUrl(url: string) {
  return url.startsWith("/api/users?") && url.includes("teamId=3");
}
function isPoolUrl(url: string) {
  return url.startsWith("/api/users?") && !url.includes("teamId=");
}

function renderTeamMembers(id: number | string = 3) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/teams/${id}/members`]}>
          <Routes>
            <Route path="/teams/:id/members" element={<TeamMembers />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("TeamMembers page", () => {
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

  test("renders heading and the team's members, querying by teamId", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/teams/3") return Promise.resolve(jsonResponse(200, TEAM));
      if (isMembersUrl(url)) return Promise.resolve(usersPage(MEMBERS));
      if (isPoolUrl(url)) return Promise.resolve(usersPage(ALL_USERS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    renderTeamMembers(3);

    expect(await screen.findByRole("heading", { name: "Members — Platform" })).toBeInTheDocument();
    expect(await screen.findByRole("cell", { name: "Carol" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "dave@example.com" })).toBeInTheDocument();

    const membersCall = mockFetch.mock.calls.find(([u]) => typeof u === "string" && isMembersUrl(u));
    expect(membersCall).toBeDefined();
  });

  test("non-admin gets a read-only roster: no add picker, no remove buttons", async () => {
    localStorage.setItem(ROLE_KEY, "USER");
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/teams/3") return Promise.resolve(jsonResponse(200, TEAM));
      if (isMembersUrl(url)) return Promise.resolve(usersPage(MEMBERS));
      // The full-user-pool query (add picker) must not run for non-admins.
      if (isPoolUrl(url)) return Promise.resolve(usersPage(ALL_USERS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    renderTeamMembers(3);

    // Not redirected away: the roster renders.
    expect(await screen.findByRole("heading", { name: "Members — Platform" })).toBeInTheDocument();
    expect(await screen.findByRole("cell", { name: "Carol" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "dave@example.com" })).toBeInTheDocument();

    // No management controls.
    expect(screen.queryByLabelText("Add a user")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^remove /i })).not.toBeInTheDocument();

    // But "Provide feedback" IS available to non-admins — it is for everyone.
    expect(screen.getByRole("link", { name: "Provide feedback for Carol" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Provide feedback for Dave" })).toBeInTheDocument();

    // The add-picker user pool was never fetched.
    expect(mockFetch.mock.calls.some(([u]) => typeof u === "string" && isPoolUrl(u))).toBe(false);
  });

  test("each member row has a Provide feedback link to the new-feedback form", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/teams/3") return Promise.resolve(jsonResponse(200, TEAM));
      if (isMembersUrl(url)) return Promise.resolve(usersPage(MEMBERS));
      if (isPoolUrl(url)) return Promise.resolve(usersPage(ALL_USERS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    renderTeamMembers(3);

    const link = await screen.findByRole("link", { name: "Provide feedback for Carol" });
    expect(link).toHaveAttribute(
      "href",
      "/feedback/new?subjectId=1&subjectName=Carol",
    );
  });

  test("add picker excludes current members and the manager, and PUTs the membership", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "PUT" && url === "/api/teams/3/members/9") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url === "/api/teams/3") return Promise.resolve(jsonResponse(200, TEAM));
      if (isMembersUrl(url)) return Promise.resolve(usersPage(MEMBERS));
      if (isPoolUrl(url)) return Promise.resolve(usersPage(ALL_USERS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderTeamMembers(3);

    await screen.findByRole("cell", { name: "Carol" });

    await user.click(screen.getByPlaceholderText("Pick a user"));
    // happy-dom marks the portaled dropdown as hidden, so query with hidden:true.
    const listbox = await screen.findByRole("listbox", { hidden: true });
    const optionLabels = within(listbox)
      .getAllByRole("option", { hidden: true })
      .map((o) => o.textContent);
    // Only "Erin" is offered: Carol/Dave are already members and Mona is the manager.
    expect(optionLabels).toEqual(["Erin"]);

    await user.click(within(listbox).getByText("Erin"));
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(
        ([u, init]) =>
          (init as RequestInit | undefined)?.method === "PUT" && u === "/api/teams/3/members/9",
      );
      expect(putCall).toBeDefined();
    });
  });

  test("remove asks for confirmation then DELETEs and drops the row", async () => {
    let membersCount = 0;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE" && url === "/api/teams/3/members/1") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url === "/api/teams/3") return Promise.resolve(jsonResponse(200, TEAM));
      if (isMembersUrl(url)) {
        membersCount++;
        return Promise.resolve(usersPage(membersCount === 1 ? MEMBERS : [MEMBERS[1]]));
      }
      if (isPoolUrl(url)) return Promise.resolve(usersPage(ALL_USERS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderTeamMembers(3);

    await user.click(await screen.findByRole("button", { name: /remove carol/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^remove$/i }));

    await waitFor(() =>
      expect(screen.queryByRole("cell", { name: "Carol" })).not.toBeInTheDocument(),
    );
    const deleteCall = mockFetch.mock.calls.find(
      ([u, init]) =>
        (init as RequestInit | undefined)?.method === "DELETE" && u === "/api/teams/3/members/1",
    );
    expect(deleteCall).toBeDefined();
  });

  test("shows the empty state when the team has no members", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/teams/3") return Promise.resolve(jsonResponse(200, TEAM));
      if (isMembersUrl(url)) return Promise.resolve(usersPage([]));
      if (isPoolUrl(url)) return Promise.resolve(usersPage(ALL_USERS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    renderTeamMembers(3);

    expect(await screen.findByText(/no members yet/i)).toBeInTheDocument();
  });

  test("surfaces an alert when adding a member fails", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "PUT" && url === "/api/teams/3/members/9") {
        return Promise.resolve(jsonResponse(400, { error: "bad_request", message: "nope" }));
      }
      if (url === "/api/teams/3") return Promise.resolve(jsonResponse(200, TEAM));
      if (isMembersUrl(url)) return Promise.resolve(usersPage(MEMBERS));
      if (isPoolUrl(url)) return Promise.resolve(usersPage(ALL_USERS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderTeamMembers(3);

    await screen.findByRole("cell", { name: "Carol" });
    await user.click(screen.getByPlaceholderText("Pick a user"));
    const listbox = await screen.findByRole("listbox", { hidden: true });
    await user.click(within(listbox).getByText("Erin"));
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(await screen.findByText(/failed to add member/i)).toBeInTheDocument();
  });
});
