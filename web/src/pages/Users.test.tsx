import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Users from "./Users";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

function renderUsers() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/users"]}>
          <Routes>
            <Route path="/users" element={<Users />} />
            <Route path="/login" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

type FetchMock = ReturnType<typeof vi.fn>;


function listResponse(items: Array<{ id: number; name: string; email: string; roles: Array<"ADMIN"> }>) {
  return jsonResponse(200, { items, page: 1, pageSize: 20, total: items.length });
}

const SEED_USERS = [
  { id: 1, name: "Alice", email: "alice@example.com", roles: ["ADMIN" as const] },
  { id: 2, name: "Bob", email: "bob@example.com", roles: [] as Array<"ADMIN"> },
];

function mockListThen(mockFetch: FetchMock, ...followups: Response[]) {
  mockFetch.mockResolvedValueOnce(listResponse(SEED_USERS));
  for (const r of followups) mockFetch.mockResolvedValueOnce(r);
}

// URL-based mock so any number of list refetches (filters/sort/pagination) resolve.
function mockUsers(
  mockFetch: FetchMock,
  items: typeof SEED_USERS = SEED_USERS,
  total = items.length,
) {
  mockFetch.mockImplementation((url: string) =>
    Promise.resolve(
      String(url).startsWith("/api/v1/users?")
        ? jsonResponse(200, { items, page: 1, pageSize: 20, total })
        : jsonResponse(404, {}),
    ),
  );
}

function userUrls(mockFetch: FetchMock): string[] {
  return mockFetch.mock.calls
    .map(([url]) => String(url))
    .filter((u) => u.startsWith("/api/v1/users?"));
}

// Opens a row's admin "Modify ▾" menu (v1.52.0) — the account actions are menu items now,
// keeping their pre-grouping accessible names.
async function openModifyMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole("button", { name: `Modify actions for ${name}` }));
}

describe("Users page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, JSON.stringify(["ADMIN"]));
    localStorage.setItem(USER_ID_KEY, "1");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("admin sees a Modify menu in each row grouping the account actions", async () => {
    mockListThen(mockFetch);
    const user = userEvent.setup();
    renderUsers();

    await screen.findByText("Alice");
    expect(screen.getAllByRole("button", { name: /modify actions for /i })).toHaveLength(2);
    // The heading carries the data-tour anchor the guided tour targets for the Config → Users step.
    expect(screen.getByRole("heading", { name: "Users" })).toHaveAttribute(
      "data-tour",
      "config-users",
    );

    // The menu keeps the old buttons' accessible names — role changed to menuitem.
    await openModifyMenu(user, "Bob");
    expect(await screen.findByRole("menuitem", { name: "Edit Bob" })).toHaveAttribute(
      "href",
      "/users/2/edit",
    );
    expect(screen.getByRole("menuitem", { name: "Change password for Bob" })).toHaveAttribute(
      "href",
      "/users/2/change-password",
    );
    expect(screen.getByRole("menuitem", { name: "Deactivate Bob" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete Bob" })).toBeInTheDocument();
  });

  test("the Modify menu offers a Features item pointing at the per-user features screen (v1.53.0)", async () => {
    mockListThen(mockFetch);
    const user = userEvent.setup();
    renderUsers();

    await openModifyMenu(user, "Bob");
    const item = await screen.findByRole("menuitem", { name: "Features of Bob" });
    expect(item).toHaveAttribute("href", "/users/2/features");
    expect(item).toHaveTextContent("Features");
  });

  test("a disabled FEEDBACKS feature hides the per-row Feedback menu; Modify stays (v1.53.0)", async () => {
    localStorage.setItem("lettuce.auth.disabledFeatures", JSON.stringify(["FEEDBACKS"]));
    try {
      mockListThen(mockFetch);
      renderUsers();

      await screen.findByText("Alice");
      // The admin Modify menus still render — proof the actions column is there…
      expect(screen.getAllByRole("button", { name: /modify actions for /i })).toHaveLength(2);
      // …but no row carries a Feedback dropdown.
      expect(screen.queryByRole("button", { name: /feedback actions for /i })).toBeNull();
    } finally {
      localStorage.removeItem("lettuce.auth.disabledFeatures");
    }
  });

  test("one's own row offers Edit/password/Delete but no Deactivate", async () => {
    mockListThen(mockFetch);
    const user = userEvent.setup();
    renderUsers();

    // The current user is Alice (id 1) — self-deactivation is forbidden server-side.
    await openModifyMenu(user, "Alice");
    expect(await screen.findByRole("menuitem", { name: "Edit Alice" })).toHaveAttribute(
      "href",
      "/users/1/edit",
    );
    expect(screen.getByRole("menuitem", { name: "Change password for Alice" })).toHaveAttribute(
      "href",
      "/users/1/change-password",
    );
    expect(screen.getByRole("menuitem", { name: "Delete Alice" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /deactivate alice/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /reactivate alice/i })).not.toBeInTheDocument();
  });

  test("admin sees a Teams link per row pointing at /users/:id/teams", async () => {
    mockListThen(mockFetch);
    renderUsers();

    await screen.findByText("Alice");
    const links = screen.getAllByRole("link", { name: /^teams for /i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", `/users/1/teams?name=${encodeURIComponent("Alice")}`);
    expect(links[1]).toHaveAttribute("href", `/users/2/teams?name=${encodeURIComponent("Bob")}`);
  });

  test("every row links to the user details view — except one's own", async () => {
    mockListThen(mockFetch);
    renderUsers();

    await screen.findByText("Alice");
    // The current user is Alice (id 1) — her own row gets no details link, Bob's does.
    const links = screen.getAllByRole("link", { name: /^user details for /i });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/users/2/details?name=Bob&from=users");
  });

  test("non-admin sees the Feedback menu and Teams, but no Edit/Delete", async () => {
    localStorage.setItem(ROLE_KEY, "[]");
    mockListThen(mockFetch);
    const user = userEvent.setup();
    renderUsers();

    await screen.findByText("Alice");
    expect(screen.queryByRole("button", { name: /modify actions for /i })).not.toBeInTheDocument();
    // The actions column still renders because every user can provide/ask feedback —
    // but not on their own row (the current user is Alice, id 1).
    expect(screen.getByRole("button", { name: /feedback actions for bob/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /feedback actions for alice/i }),
    ).not.toBeInTheDocument();

    // The dropdown groups both actions, keeping the old links' accessible names.
    await user.click(screen.getByRole("button", { name: /feedback actions for bob/i }));
    expect(
      await screen.findByRole("menuitem", { name: /provide feedback for bob/i }),
    ).toHaveAttribute("href", `/feedback/new?subjectId=2`);
    expect(screen.getByRole("menuitem", { name: /ask bob for feedback/i })).toHaveAttribute(
      "href",
      `/feedback/ask?providerId=2&back=${encodeURIComponent("/users")}`,
    );
    // The drill-down item carries from=users so its "Back to …" link returns here.
    expect(screen.getByRole("menuitem", { name: /feedbacks with bob/i })).toHaveAttribute(
      "href",
      `/users/2/feedbacks?name=${encodeURIComponent("Bob")}&from=users`,
    );
    // Non-admins now also get a (read-only) Teams link per row.
    expect(screen.getAllByRole("link", { name: /^teams for /i })).toHaveLength(2);
  });

  test("Cancel in the confirmation modal closes it without calling DELETE", async () => {
    mockListThen(mockFetch);
    const user = userEvent.setup();
    renderUsers();

    await openModifyMenu(user, "Bob");
    await user.click(await screen.findByRole("menuitem", { name: "Delete Bob" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const deleteCall = mockFetch.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(deleteCall).toBeUndefined();
  });

  test("confirming triggers DELETE and refetches the list", async () => {
    mockListThen(
      mockFetch,
      new Response(null, { status: 204 }),
      listResponse([SEED_USERS[0]]),
    );
    const user = userEvent.setup();
    renderUsers();

    await openModifyMenu(user, "Bob");
    await user.click(await screen.findByRole("menuitem", { name: "Delete Bob" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(screen.queryByText("Bob")).not.toBeInTheDocument());

    const deleteCall = mockFetch.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(deleteCall).toBeDefined();
    expect(deleteCall![0]).toBe("/api/v1/users/2");

    const listCalls = mockFetch.mock.calls.filter(([url, init]) => {
      const method = init?.method ?? "GET";
      return method === "GET" && typeof url === "string" && url.startsWith("/api/v1/users?");
    });
    expect(listCalls.length).toBeGreaterThanOrEqual(2);
  });

  test("self-delete logs out and redirects to /login", async () => {
    mockListThen(
      mockFetch,
      new Response(null, { status: 204 }), // DELETE /api/users/1
      new Response(null, { status: 204 }), // POST /api/logout
    );
    const user = userEvent.setup();
    renderUsers();

    await openModifyMenu(user, "Alice");
    await user.click(await screen.findByRole("menuitem", { name: "Delete Alice" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/login"));

    const logoutCall = mockFetch.mock.calls.find(([url]) => url === "/api/v1/logout");
    expect(logoutCall).toBeDefined();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(USER_ID_KEY)).toBeNull();
  });

  test("typing the Name filter refetches with name= (debounced); clear resets it", async () => {
    mockUsers(mockFetch);
    const user = userEvent.setup();
    renderUsers();

    await screen.findByText("Alice");
    await user.click(screen.getByRole("button", { name: /filters/i }));
    const nameInput = screen.getByLabelText("Name");
    await user.type(nameInput, "Ali");
    await waitFor(
      () => expect(userUrls(mockFetch).some((u) => u.includes("name=Ali"))).toBe(true),
      { timeout: 1500 },
    );

    await user.click(screen.getByRole("button", { name: /clear name filter/i }));
    expect(nameInput).toHaveValue("");
  });

  test("filters are collapsed by default and the toggle reveals them", async () => {
    mockUsers(mockFetch);
    const user = userEvent.setup();
    renderUsers();

    await screen.findByText("Alice");
    const toggle = screen.getByRole("button", { name: /filters/i });
    // Collapsed by default — the toggle reports it and the space-eating filter row is hidden;
    // the Name quick search stays in the toolbar regardless (v3.3.0).
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Email")).toBeInTheDocument();

    // Toggling again collapses it.
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("the Filters toggle shows a badge counting the active filters", async () => {
    mockUsers(mockFetch);
    const user = userEvent.setup();
    renderUsers();

    await screen.findByText("Alice");
    const toggle = screen.getByRole("button", { name: /filters/i });
    // No filters set → no badge.
    expect(within(toggle).queryByText("1")).not.toBeInTheDocument();

    await user.click(toggle);
    // The quick search (Name) is not a panel filter — only the panel's own inputs count.
    await user.type(screen.getByLabelText("Name"), "Ali");
    expect(within(toggle).queryByText("1")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Email"), "ali");
    expect(within(toggle).getByText("1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByLabelText("Email")).toHaveValue("");
    expect(within(toggle).queryByText("1")).not.toBeInTheDocument();
  });

  test("typing the Email filter refetches with email=", async () => {
    mockUsers(mockFetch);
    const user = userEvent.setup();
    renderUsers();

    await screen.findByText("Alice");
    await user.click(screen.getByRole("button", { name: /filters/i }));
    await user.type(screen.getByLabelText("Email"), "alice");
    await waitFor(
      () => expect(userUrls(mockFetch).some((u) => u.includes("email=alice"))).toBe(true),
      { timeout: 1500 },
    );
  });

  test("selecting a Role filter refetches with role=ADMIN", async () => {
    mockUsers(mockFetch);
    renderUsers();

    await screen.findByText("Alice");
    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(screen.getByLabelText("Role", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: /admin/i }));
    await waitFor(() => expect(userUrls(mockFetch).some((u) => u.includes("role=ADMIN"))).toBe(true));
  });

  test("sort headers toggle direction and switch field", async () => {
    mockUsers(mockFetch);
    const user = userEvent.setup();
    renderUsers();

    await screen.findByText("Alice");
    await user.click(screen.getByRole("button", { name: /name/i }));
    await waitFor(() => expect(userUrls(mockFetch).some((u) => u.includes("sort=-name"))).toBe(true));

    await user.click(screen.getByRole("button", { name: /email/i }));
    await waitFor(() => expect(userUrls(mockFetch).some((u) => u.includes("sort=email"))).toBe(true));
  });

  test("changing page size refetches with pageSize and resets to page 1", async () => {
    mockUsers(mockFetch);
    renderUsers();

    await screen.findByText("Alice");
    fireEvent.click(screen.getByLabelText("Rows per page", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "40 / page" }));
    await waitFor(() =>
      expect(
        userUrls(mockFetch).some((u) => u.includes("pageSize=40") && u.includes("page=1")),
      ).toBe(true),
    );
  });

  test("clicking page 2 refetches with page=2", async () => {
    mockUsers(mockFetch, SEED_USERS, 25); // 25 total / 20 per page → 2 pages
    const user = userEvent.setup();
    renderUsers();

    await screen.findByText("Alice");
    await user.click(screen.getByRole("button", { name: "2" }));
    await waitFor(() => expect(userUrls(mockFetch).some((u) => u.includes("page=2"))).toBe(true));
  });

  test("shows an alert when the list fails to load", async () => {
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).startsWith("/api/v1/users?")
          ? jsonResponse(500, { error: "internal", message: "boom" })
          : jsonResponse(404, {}),
      ),
    );
    renderUsers();
    expect(await screen.findByText("Failed to load users")).toBeInTheDocument();
    // A load failure must not additionally claim the list is empty.
    expect(screen.queryByText("No users")).toBeNull();
  });

  test("shows the empty state when there are no users", async () => {
    mockUsers(mockFetch, [], 0);
    renderUsers();
    expect(await screen.findByText("No users")).toBeInTheDocument();
  });

  test("admin sees New user and Mass import links; a non-admin sees neither", async () => {
    mockUsers(mockFetch);
    const { unmount } = renderUsers();
    expect(await screen.findByRole("link", { name: /new user/i })).toHaveAttribute(
      "href",
      "/users/new",
    );
    expect(screen.getByRole("link", { name: /mass import/i })).toHaveAttribute(
      "href",
      "/users/import",
    );
    unmount();

    localStorage.setItem(ROLE_KEY, "[]");
    mockUsers(mockFetch);
    renderUsers();
    await screen.findByText("Alice");
    expect(screen.queryByRole("link", { name: /new user/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /mass import/i })).not.toBeInTheDocument();
  });

  test("the modal Cancel button is disabled while the delete is in flight", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE") return new Promise(() => {}); // never resolves
      if (String(url).startsWith("/api/v1/users?")) return Promise.resolve(listResponse(SEED_USERS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderUsers();

    await openModifyMenu(user, "Bob");
    await user.click(await screen.findByRole("menuitem", { name: "Delete Bob" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    expect(within(dialog).getByRole("button", { name: /cancel/i })).toBeDisabled();
  });

  test("server error surfaces an alert and keeps the modal open", async () => {
    mockListThen(
      mockFetch,
      jsonResponse(500, { error: "internal", message: "boom" }),
    );
    const user = userEvent.setup();
    renderUsers();

    await openModifyMenu(user, "Bob");
    await user.click(await screen.findByRole("menuitem", { name: "Delete Bob" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    expect(await within(dialog).findByText(/failed to delete user/i)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("restores persisted filters and sort from localStorage into the first query", async () => {
    localStorage.setItem("lettuce.viewSettings.users.filter.name", JSON.stringify("ali"));
    localStorage.setItem(
      "lettuce.viewSettings.users.paging",
      JSON.stringify({ sortField: "email", sortDir: "desc", pageSize: 40 }),
    );
    localStorage.setItem("lettuce.viewSettings.users.filtersOpen", "true");
    mockUsers(mockFetch);
    renderUsers();

    await screen.findByText("Alice");
    const first = userUrls(mockFetch)[0];
    expect(first).toContain("name=ali");
    expect(first).toContain("sort=-email");
    expect(first).toContain("pageSize=40");
    // The panel opens restored, showing the persisted filter value.
    expect(screen.getByLabelText("Name")).toHaveValue("ali");
  });

  test("ignores a persisted sort field that is no longer sortable", async () => {
    localStorage.setItem(
      "lettuce.viewSettings.users.paging",
      JSON.stringify({ sortField: "bogus", sortDir: "desc", pageSize: 999 }),
    );
    mockUsers(mockFetch);
    renderUsers();

    await screen.findByText("Alice");
    const first = userUrls(mockFetch)[0];
    expect(first).toContain("sort=-name"); // field falls back to the default, direction survives
    expect(first).toContain("pageSize=20");
  });

  test("typing a filter and toggling sort persists them to localStorage", async () => {
    mockUsers(mockFetch);
    const user = userEvent.setup();
    renderUsers();

    await screen.findByText("Alice");
    await user.click(screen.getByRole("button", { name: /filters/i }));
    await user.type(screen.getByLabelText("Name"), "Bo");
    await user.click(screen.getByRole("button", { name: /^email$/i }));

    await waitFor(() => {
      expect(localStorage.getItem("lettuce.viewSettings.users.filter.name")).toBe(
        JSON.stringify("Bo"),
      );
      expect(
        JSON.parse(localStorage.getItem("lettuce.viewSettings.users.paging")!),
      ).toEqual({ sortField: "email", sortDir: "asc", pageSize: 20 });
    });
  });

  test("a deactivated user shows the Inactive badge and a Reactivate action instead of Deactivate", async () => {
    const items = [
      SEED_USERS[0],
      { id: 2, name: "Bob", email: "bob@example.com", roles: [] as Array<"ADMIN">, deactivated: true },
    ];
    mockUsers(mockFetch, items);
    const user = userEvent.setup();
    renderUsers();

    await screen.findByText("Bob");
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    await openModifyMenu(user, "Bob");
    expect(await screen.findByRole("menuitem", { name: "Reactivate Bob" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Deactivate Bob" })).not.toBeInTheDocument();
  });

  test("confirming Deactivate POSTs the transition and refetches", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && String(url).startsWith("/api/v1/users?")) {
        return Promise.resolve(listResponse(SEED_USERS));
      }
      if (method === "POST" && url === "/api/v1/users/2/deactivate") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(jsonResponse(500, {}));
    });
    const user = userEvent.setup();
    renderUsers();

    await openModifyMenu(user, "Bob");
    await user.click(await screen.findByRole("menuitem", { name: "Deactivate Bob" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/will no longer be able to sign in/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /^deactivate$/i }));

    await waitFor(() => {
      const post = mockFetch.mock.calls.find(([, init]) => init?.method === "POST");
      expect(post).toBeDefined();
      expect(post![0]).toBe("/api/v1/users/2/deactivate");
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("Reactivate POSTs the activate transition without a modal", async () => {
    const items = [
      SEED_USERS[0],
      { id: 2, name: "Bob", email: "bob@example.com", roles: [] as Array<"ADMIN">, deactivated: true },
    ];
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && String(url).startsWith("/api/v1/users?")) {
        return Promise.resolve(jsonResponse(200, { items, page: 1, pageSize: 20, total: 2 }));
      }
      if (method === "POST" && url === "/api/v1/users/2/activate") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(jsonResponse(500, {}));
    });
    const user = userEvent.setup();
    renderUsers();

    await openModifyMenu(user, "Bob");
    await user.click(await screen.findByRole("menuitem", { name: "Reactivate Bob" }));

    await waitFor(() => {
      const post = mockFetch.mock.calls.find(([, init]) => init?.method === "POST");
      expect(post).toBeDefined();
      expect(post![0]).toBe("/api/v1/users/2/activate");
    });
  });

  test("selecting the Status filter refetches with deactivated=", async () => {
    mockUsers(mockFetch);
    renderUsers();

    await screen.findByText("Alice");
    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(screen.getByLabelText("Status", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: /^inactive$/i }));
    await waitFor(() =>
      expect(userUrls(mockFetch).some((u) => u.includes("deactivated=true"))).toBe(true),
    );
  });

  test("non-admin sees no Modify menu (and hence no Deactivate)", async () => {
    localStorage.setItem(ROLE_KEY, "[]");
    mockListThen(mockFetch);
    renderUsers();

    await screen.findByText("Alice");
    expect(screen.queryByRole("button", { name: /modify actions for /i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^deactivate /i })).not.toBeInTheDocument();
  });

  test("shows the unique id value, and the orange Not set badge on rows without one", async () => {
    const items = [
      { id: 1, name: "Alice", email: "alice@example.com", roles: [] as Array<"ADMIN">, uniqueId: "EMP-42" },
      SEED_USERS[1],
    ];
    mockUsers(mockFetch, items);
    renderUsers();

    await screen.findByText("EMP-42");
    // Bob has no unique id → the actionable-missing cue (one badge, Alice has none).
    expect(screen.getAllByText("Not set")).toHaveLength(1);
  });

  test("typing the Unique ID filter refetches with uniqueId= (debounced)", async () => {
    mockUsers(mockFetch);
    const user = userEvent.setup();
    renderUsers();

    await screen.findByText("Alice");
    await user.click(screen.getByRole("button", { name: /filters/i }));
    // selector-scoped: the rows' aria-labelled Unique ID cells share the accessible name.
    await user.type(screen.getByLabelText("Unique ID", { selector: "input" }), "EMP");
    await waitFor(
      () => expect(userUrls(mockFetch).some((u) => u.includes("uniqueId=EMP"))).toBe(true),
      { timeout: 1500 },
    );
  });

  test("selecting the Unique ID status filter refetches with uniqueIdMissing=", async () => {
    mockUsers(mockFetch);
    renderUsers();

    await screen.findByText("Alice");
    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(screen.getByLabelText("Unique ID status", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: /^missing$/i }));
    await waitFor(() =>
      expect(userUrls(mockFetch).some((u) => u.includes("uniqueIdMissing=true"))).toBe(true),
    );
  });
});
