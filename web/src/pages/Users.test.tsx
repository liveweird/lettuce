import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Users from "./Users";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";
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
    <MantineProvider>
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function listResponse(items: Array<{ id: number; name: string; email: string; role: "ADMIN" | "USER" }>) {
  return jsonResponse(200, { items, page: 1, pageSize: 20, total: items.length });
}

const SEED_USERS = [
  { id: 1, name: "Alice", email: "alice@example.com", role: "ADMIN" as const },
  { id: 2, name: "Bob", email: "bob@example.com", role: "USER" as const },
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

describe("Users page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "ADMIN");
    localStorage.setItem(USER_ID_KEY, "1");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("admin sees a Delete button in each row", async () => {
    mockListThen(mockFetch);
    renderUsers();

    await screen.findByText("Alice");
    expect(screen.getAllByRole("button", { name: /^delete /i })).toHaveLength(2);
    // The heading carries the data-tour anchor the guided tour targets for the Config → Users step.
    expect(screen.getByRole("heading", { name: "Users" })).toHaveAttribute(
      "data-tour",
      "config-users",
    );
  });

  test("admin sees an Edit link per row pointing at /users/:id/edit", async () => {
    mockListThen(mockFetch);
    renderUsers();

    await screen.findByText("Alice");
    const editLinks = screen.getAllByRole("link", { name: /^edit /i });
    expect(editLinks).toHaveLength(2);
    expect(editLinks[0]).toHaveAttribute("href", "/users/1/edit");
    expect(editLinks[1]).toHaveAttribute("href", "/users/2/edit");
  });

  test("admin sees a Change password link per row pointing at /users/:id/change-password", async () => {
    mockListThen(mockFetch);
    renderUsers();

    await screen.findByText("Alice");
    const links = screen.getAllByRole("link", { name: /^change password for /i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/users/1/change-password");
    expect(links[1]).toHaveAttribute("href", "/users/2/change-password");
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

  test("non-admin sees Provide feedback and Teams, but no Edit/Delete", async () => {
    localStorage.setItem(ROLE_KEY, "USER");
    mockListThen(mockFetch);
    renderUsers();

    await screen.findByText("Alice");
    expect(screen.queryByRole("button", { name: /^delete /i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^edit /i })).not.toBeInTheDocument();
    // The actions column still renders because every user can provide feedback —
    // but not on their own row (the current user is Alice, id 1).
    expect(screen.getByRole("link", { name: /provide feedback for bob/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /provide feedback for alice/i })).not.toBeInTheDocument();
    // Non-admins now also get a (read-only) Teams link per row.
    expect(screen.getAllByRole("link", { name: /^teams for /i })).toHaveLength(2);
  });

  test("Cancel in the confirmation modal closes it without calling DELETE", async () => {
    mockListThen(mockFetch);
    const user = userEvent.setup();
    renderUsers();

    await user.click(await screen.findByRole("button", { name: /delete bob/i }));
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

    await user.click(await screen.findByRole("button", { name: /delete bob/i }));
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

    await user.click(await screen.findByRole("button", { name: /delete alice/i }));
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
    // Collapsed by default — the toggle reports it and the space-eating filter row is hidden.
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Name")).toBeInTheDocument();

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
    await user.type(screen.getByLabelText("Name"), "Ali");
    expect(within(toggle).getByText("1")).toBeInTheDocument();
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
  });

  test("shows the empty state when there are no users", async () => {
    mockUsers(mockFetch, [], 0);
    renderUsers();
    expect(await screen.findByText("No users")).toBeInTheDocument();
  });

  test("admin sees a Create user link; a non-admin does not", async () => {
    mockUsers(mockFetch);
    const { unmount } = renderUsers();
    expect(await screen.findByRole("link", { name: /create user/i })).toHaveAttribute(
      "href",
      "/users/new",
    );
    unmount();

    localStorage.setItem(ROLE_KEY, "USER");
    mockUsers(mockFetch);
    renderUsers();
    await screen.findByText("Alice");
    expect(screen.queryByRole("link", { name: /create user/i })).not.toBeInTheDocument();
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

    await user.click(await screen.findByRole("button", { name: /delete bob/i }));
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

    await user.click(await screen.findByRole("button", { name: /delete bob/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    expect(await within(dialog).findByText(/failed to delete user/i)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
