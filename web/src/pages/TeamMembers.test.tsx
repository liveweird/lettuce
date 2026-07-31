import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TeamMembers from "./TeamMembers";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";

type FetchMock = ReturnType<typeof vi.fn>;


type UserItem = { id: number; name: string; email: string; roles: Array<"ADMIN"> };

function usersPage(items: UserItem[]) {
  return jsonResponse(200, { items, page: 1, pageSize: 100, total: items.length });
}

// Team 3 is managed by user 10; its members are users 1 and 2.
const TEAM = { id: 3, name: "Platform", managerId: 10, memberIds: [1, 2] };
const MEMBERS: UserItem[] = [
  { id: 1, name: "Carol", email: "carol@example.com", roles: [] },
  { id: 2, name: "Dave", email: "dave@example.com", roles: [] },
];
const ALL_USERS: UserItem[] = [
  ...MEMBERS,
  { id: 9, name: "Erin", email: "erin@example.com", roles: [] },
  { id: 10, name: "Mona Manager", email: "mona@example.com", roles: ["ADMIN"] },
];

function isMembersUrl(url: string) {
  return url.startsWith("/api/v1/users?") && url.includes("teamId=3");
}
function isPoolUrl(url: string) {
  return url.startsWith("/api/v1/users?") && !url.includes("teamId=");
}

function renderTeamMembers(id: number | string = 3, search = "") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/teams/${id}/members${search}`]}>
          <Routes>
            <Route path="/teams/:id/members" element={<TeamMembers />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

// Mocks team(3)/members/pool happy-path; the PUT that adds Erin (id 9) yields `putResult`.
function mockAddError(mockFetch: FetchMock, putResult: () => Promise<Response>) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "PUT" && url === "/api/v1/teams/3/members/9") return putResult();
    if (url === "/api/v1/teams/3") return Promise.resolve(jsonResponse(200, TEAM));
    if (isMembersUrl(url)) return Promise.resolve(usersPage(MEMBERS));
    if (isPoolUrl(url)) return Promise.resolve(usersPage(ALL_USERS));
    return Promise.resolve(jsonResponse(404, {}));
  });
}

// Pick "Erin" from the add picker and click Add.
async function addErin(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("Carol");
  await user.click(screen.getByPlaceholderText("Pick a user"));
  const listbox = await screen.findByRole("listbox", { hidden: true });
  await user.click(within(listbox).getByText("Erin"));
  await user.click(screen.getByRole("button", { name: /^add$/i }));
}

describe("TeamMembers page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, JSON.stringify(["ADMIN"]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders heading and the team's members, querying by teamId", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/v1/teams/3") return Promise.resolve(jsonResponse(200, TEAM));
      if (isMembersUrl(url)) return Promise.resolve(usersPage(MEMBERS));
      if (isPoolUrl(url)) return Promise.resolve(usersPage(ALL_USERS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    renderTeamMembers(3);

    expect(await screen.findByRole("heading", { name: "Members — Platform" })).toBeInTheDocument();
    expect(await screen.findByText("Carol")).toBeInTheDocument();
    expect(screen.getByText("dave@example.com")).toBeInTheDocument();

    const membersCall = mockFetch.mock.calls.find(([u]) => typeof u === "string" && isMembersUrl(u));
    expect(membersCall).toBeDefined();
  });

  test("opened from the org chart, the back link returns to /org instead of the teams list", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/v1/teams/3") return Promise.resolve(jsonResponse(200, TEAM));
      if (isMembersUrl(url)) return Promise.resolve(usersPage(MEMBERS));
      if (isPoolUrl(url)) return Promise.resolve(usersPage(ALL_USERS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    renderTeamMembers(3, "?from=org");

    expect(await screen.findByRole("link", { name: "← Back to Org chart" })).toHaveAttribute(
      "href",
      "/org",
    );
    expect(screen.queryByText("Back to teams")).not.toBeInTheDocument();
  });

  test("non-admin gets a read-only roster: no add picker, no remove buttons", async () => {
    localStorage.setItem(ROLE_KEY, "[]");
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/v1/teams/3") return Promise.resolve(jsonResponse(200, TEAM));
      if (isMembersUrl(url)) return Promise.resolve(usersPage(MEMBERS));
      // The full-user-pool query (add picker) must not run for non-admins.
      if (isPoolUrl(url)) return Promise.resolve(usersPage(ALL_USERS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    renderTeamMembers(3);

    // Not redirected away: the roster renders.
    expect(await screen.findByRole("heading", { name: "Members — Platform" })).toBeInTheDocument();
    expect(await screen.findByText("Carol")).toBeInTheDocument();
    expect(screen.getByText("dave@example.com")).toBeInTheDocument();

    // No management controls.
    expect(screen.queryByLabelText("Add a user")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^remove /i })).not.toBeInTheDocument();

    // But the Feedback actions menu IS available to non-admins — it is for everyone.
    expect(screen.getByRole("button", { name: "Feedback actions for Carol" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Feedback actions for Dave" })).toBeInTheDocument();

    // And so is the User details link, carrying the members origin + teamId back here.
    const detailLinks = screen.getAllByRole("link", { name: /^user details for /i });
    expect(detailLinks).toHaveLength(2);
    expect(detailLinks[0]).toHaveAttribute(
      "href",
      "/users/1/details?name=Carol&from=members&teamId=3",
    );
    expect(detailLinks[1]).toHaveAttribute(
      "href",
      "/users/2/details?name=Dave&from=members&teamId=3",
    );

    // The add-picker user pool was never fetched.
    expect(mockFetch.mock.calls.some(([u]) => typeof u === "string" && isPoolUrl(u))).toBe(false);
  });

  test("each member row's Feedback menu offers Provide and Ask links, returning here", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/v1/teams/3") return Promise.resolve(jsonResponse(200, TEAM));
      if (isMembersUrl(url)) return Promise.resolve(usersPage(MEMBERS));
      if (isPoolUrl(url)) return Promise.resolve(usersPage(ALL_USERS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderTeamMembers(3);

    await user.click(await screen.findByRole("button", { name: "Feedback actions for Carol" }));
    expect(
      await screen.findByRole("menuitem", { name: "Provide feedback for Carol" }),
    ).toHaveAttribute("href", "/feedback/new?subjectId=1&subjectName=Carol");
    expect(screen.getByRole("menuitem", { name: "Ask Carol for feedback" })).toHaveAttribute(
      "href",
      `/feedback/ask?providerId=1&providerName=Carol&back=${encodeURIComponent("/teams/3/members")}`,
    );
    // The drill-down item carries from=members + the team id so "Back to …" returns to this roster.
    expect(screen.getByRole("menuitem", { name: "Feedbacks with Carol" })).toHaveAttribute(
      "href",
      "/users/1/feedbacks?name=Carol&from=members&teamId=3",
    );
  });

  test("add picker excludes current members and the manager, and PUTs the membership", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "PUT" && url === "/api/v1/teams/3/members/9") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url === "/api/v1/teams/3") return Promise.resolve(jsonResponse(200, TEAM));
      if (isMembersUrl(url)) return Promise.resolve(usersPage(MEMBERS));
      if (isPoolUrl(url)) return Promise.resolve(usersPage(ALL_USERS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderTeamMembers(3);

    await screen.findByText("Carol");

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
          (init as RequestInit | undefined)?.method === "PUT" && u === "/api/v1/teams/3/members/9",
      );
      expect(putCall).toBeDefined();
    });
  });

  test("remove asks for confirmation then DELETEs and drops the row", async () => {
    let membersCount = 0;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE" && url === "/api/v1/teams/3/members/1") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url === "/api/v1/teams/3") return Promise.resolve(jsonResponse(200, TEAM));
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
      // Scope to the table — after removal "Carol" may still exist in the add-picker pool.
      expect(within(screen.getByRole("table")).queryByText("Carol")).not.toBeInTheDocument(),
    );
    const deleteCall = mockFetch.mock.calls.find(
      ([u, init]) =>
        (init as RequestInit | undefined)?.method === "DELETE" && u === "/api/v1/teams/3/members/1",
    );
    expect(deleteCall).toBeDefined();
  });

  test("shows the empty state when the team has no members", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/v1/teams/3") return Promise.resolve(jsonResponse(200, TEAM));
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
      if (method === "PUT" && url === "/api/v1/teams/3/members/9") {
        return Promise.resolve(jsonResponse(400, { error: "bad_request", message: "nope" }));
      }
      if (url === "/api/v1/teams/3") return Promise.resolve(jsonResponse(200, TEAM));
      if (isMembersUrl(url)) return Promise.resolve(usersPage(MEMBERS));
      if (isPoolUrl(url)) return Promise.resolve(usersPage(ALL_USERS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderTeamMembers(3);

    await screen.findByText("Carol");
    await user.click(screen.getByPlaceholderText("Pick a user"));
    const listbox = await screen.findByRole("listbox", { hidden: true });
    await user.click(within(listbox).getByText("Erin"));
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(await screen.findByText(/failed to add member/i)).toBeInTheDocument();
  });

  test("add member 403 shows the permission message", async () => {
    mockAddError(mockFetch, () => Promise.resolve(jsonResponse(403, { error: "forbidden" })));
    const user = userEvent.setup();
    renderTeamMembers(3);
    await addErin(user);
    expect(
      await screen.findByText("You don't have permission to modify this team."),
    ).toBeInTheDocument();
  });

  test("add member 404 shows the team-gone message", async () => {
    mockAddError(mockFetch, () => Promise.resolve(jsonResponse(404, { error: "not_found" })));
    const user = userEvent.setup();
    renderTeamMembers(3);
    await addErin(user);
    expect(await screen.findByText("Team no longer exists.")).toBeInTheDocument();
  });

  test("add member with an unexpected status shows the generic status message", async () => {
    mockAddError(mockFetch, () => Promise.resolve(jsonResponse(500, { error: "internal" })));
    const user = userEvent.setup();
    renderTeamMembers(3);
    await addErin(user);
    expect(await screen.findByText("Add failed (500)")).toBeInTheDocument();
  });

  test("add member network failure shows the connection message", async () => {
    mockAddError(mockFetch, () => Promise.reject(new Error("network down")));
    const user = userEvent.setup();
    renderTeamMembers(3);
    await addErin(user);
    expect(
      await screen.findByText("Add failed. Check your connection and try again."),
    ).toBeInTheDocument();
  });

  test("a 404 on the team shows the not-found alert", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/v1/teams/3") return Promise.resolve(jsonResponse(404, { error: "not_found" }));
      if (isMembersUrl(url)) return Promise.resolve(usersPage(MEMBERS));
      if (isPoolUrl(url)) return Promise.resolve(usersPage(ALL_USERS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    renderTeamMembers(3);
    expect(await screen.findByText("Team not found.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to teams/i })).toBeInTheDocument();
  });

  test("a non-404 team error shows the generic load-failed alert with status", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/v1/teams/3") return Promise.resolve(jsonResponse(500, { error: "internal" }));
      if (isMembersUrl(url)) return Promise.resolve(usersPage(MEMBERS));
      if (isPoolUrl(url)) return Promise.resolve(usersPage(ALL_USERS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    renderTeamMembers(3);
    expect(await screen.findByText(/failed to load team \(500\)/i)).toBeInTheDocument();
  });

  test("a members-list error shows an alert", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/v1/teams/3") return Promise.resolve(jsonResponse(200, TEAM));
      if (isMembersUrl(url)) return Promise.resolve(jsonResponse(500, { error: "internal" }));
      if (isPoolUrl(url)) return Promise.resolve(usersPage(ALL_USERS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    renderTeamMembers(3);
    expect(await screen.findByText(/failed to load members/i)).toBeInTheDocument();
  });

  test("a remove failure shows an alert inside the modal and keeps it open", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE" && url === "/api/v1/teams/3/members/1") {
        return Promise.resolve(jsonResponse(500, { error: "internal" }));
      }
      if (url === "/api/v1/teams/3") return Promise.resolve(jsonResponse(200, TEAM));
      if (isMembersUrl(url)) return Promise.resolve(usersPage(MEMBERS));
      if (isPoolUrl(url)) return Promise.resolve(usersPage(ALL_USERS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderTeamMembers(3);

    await user.click(await screen.findByRole("button", { name: /remove carol/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^remove$/i }));

    expect(await within(dialog).findByText(/failed to remove member/i)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("the modal Cancel button is disabled while the remove is in flight", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE" && url === "/api/v1/teams/3/members/1") return new Promise(() => {});
      if (url === "/api/v1/teams/3") return Promise.resolve(jsonResponse(200, TEAM));
      if (isMembersUrl(url)) return Promise.resolve(usersPage(MEMBERS));
      if (isPoolUrl(url)) return Promise.resolve(usersPage(ALL_USERS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderTeamMembers(3);

    await user.click(await screen.findByRole("button", { name: /remove carol/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^remove$/i }));
    expect(within(dialog).getByRole("button", { name: /cancel/i })).toBeDisabled();
  });
});
