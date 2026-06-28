import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Teams from "./Teams";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function teamsPage(
  items: Array<{
    id: number;
    name: string;
    managerId: number;
    managerName: string;
    managerDeleted?: boolean;
  }>,
  total = items.length,
) {
  return jsonResponse(200, {
    items: items.map((t) => ({ managerDeleted: false, ...t })),
    page: 1,
    pageSize: 20,
    total,
  });
}

function usersPage(items: Array<{ id: number; name: string; email: string; role: "ADMIN" | "USER" }>) {
  return jsonResponse(200, { items, page: 1, pageSize: 100, total: items.length });
}

const SEED_TEAMS = [
  { id: 1, name: "Platform", managerId: 10, managerName: "Alice Manager" },
  { id: 2, name: "Mobile", managerId: 11, managerName: "Bob Manager" },
];

const SEED_MANAGERS = [
  { id: 10, name: "Alice Manager", email: "alice@example.com", role: "ADMIN" as const },
  { id: 11, name: "Bob Manager", email: "bob@example.com", role: "USER" as const },
];

function routeFor(url: string): "teams" | "users" | "other" {
  if (url.startsWith("/api/teams")) return "teams";
  if (url.startsWith("/api/users")) return "users";
  return "other";
}

function setupMocks(mockFetch: FetchMock, teamsByUrl: (url: string) => Response) {
  mockFetch.mockImplementation((url: string) => {
    const route = routeFor(url);
    if (route === "users") return Promise.resolve(usersPage(SEED_MANAGERS));
    if (route === "teams") return Promise.resolve(teamsByUrl(url));
    return Promise.resolve(jsonResponse(404, {}));
  });
}

function renderTeams() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/teams"]}>
          <Teams />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("Teams page", () => {
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

  test("renders rows showing team name and manager name", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    renderTeams();

    expect(await screen.findByRole("cell", { name: "Platform" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Mobile" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Alice Manager" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Bob Manager" })).toBeInTheDocument();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/teams\?/),
      expect.any(Object),
    );
    // The heading carries the data-tour anchor the guided tour targets for the Config → Teams step.
    expect(screen.getByRole("heading", { name: "Teams" })).toHaveAttribute(
      "data-tour",
      "config-teams",
    );
  });

  test("typing in the Name filter triggers a refetch with name=", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    const user = userEvent.setup();
    renderTeams();

    await screen.findByText("Platform");
    await user.type(screen.getByLabelText(/name/i), "Mobi");

    await waitFor(
      () => {
        const called = mockFetch.mock.calls.some(([url]) =>
          typeof url === "string" && url.startsWith("/api/teams?") && url.includes("name=Mobi"),
        );
        expect(called).toBe(true);
      },
      { timeout: 1500 },
    );
  });

  test("pagination button click triggers a GET with page=2", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS, 25));
    const user = userEvent.setup();
    renderTeams();

    await screen.findByText("Platform");
    await user.click(screen.getByRole("button", { name: "2" }));

    await waitFor(() => {
      const called = mockFetch.mock.calls.some(([url]) =>
        typeof url === "string" && url.startsWith("/api/teams?") && url.includes("page=2"),
      );
      expect(called).toBe(true);
    });
  });

  test("manager picker is populated with the prefetched users", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    renderTeams();

    await screen.findByText("Platform");

    await waitFor(() => {
      const userCall = mockFetch.mock.calls.find(([url]) =>
        typeof url === "string" && url.startsWith("/api/users?") && url.includes("pageSize=100"),
      );
      expect(userCall).toBeDefined();
    });

    const managerSelect = screen.getByLabelText(/manager/i, { selector: "input" });
    expect(managerSelect).not.toBeDisabled();
  });

  test("clearing the Name filter empties the input", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    const user = userEvent.setup();
    renderTeams();

    await screen.findByText("Platform");
    const nameInput = screen.getByLabelText(/name/i);
    await user.type(nameInput, "Mobi");
    await user.click(await screen.findByRole("button", { name: /clear name filter/i }));
    expect(nameInput).toHaveValue("");
  });

  test("selecting a Manager filter refetches with managerId=", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    renderTeams();

    await screen.findByText("Platform");
    fireEvent.click(screen.getByLabelText(/manager/i, { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "Alice Manager", hidden: true }));
    await waitFor(() => {
      const called = mockFetch.mock.calls.some(
        ([url]) =>
          typeof url === "string" && url.startsWith("/api/teams?") && url.includes("managerId=10"),
      );
      expect(called).toBe(true);
    });
  });

  test("clicking the Name sort header toggles to sort=-name", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    const user = userEvent.setup();
    renderTeams();

    await screen.findByText("Platform");
    await user.click(screen.getByRole("button", { name: /name/i }));
    await waitFor(() => {
      const called = mockFetch.mock.calls.some(
        ([url]) =>
          typeof url === "string" && url.startsWith("/api/teams?") && url.includes("sort=-name"),
      );
      expect(called).toBe(true);
    });
  });

  test("changing the page size refetches with pageSize and resets to page 1", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    renderTeams();

    await screen.findByText("Platform");
    fireEvent.click(screen.getByLabelText("Rows per page", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "40 / page" }));
    await waitFor(() => {
      const called = mockFetch.mock.calls.some(
        ([url]) =>
          typeof url === "string" &&
          url.startsWith("/api/teams?") &&
          url.includes("pageSize=40") &&
          url.includes("page=1"),
      );
      expect(called).toBe(true);
    });
  });

  test("admin sees an Edit link per row pointing at /teams/:id/edit", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    renderTeams();

    await screen.findByRole("cell", { name: "Platform" });
    const editLinks = screen.getAllByRole("link", { name: /^edit /i });
    expect(editLinks).toHaveLength(2);
    expect(editLinks[0]).toHaveAttribute("href", "/teams/1/edit");
  });

  test("shows an alert when the list fails to load", async () => {
    setupMocks(mockFetch, () => jsonResponse(500, { error: "internal", message: "boom" }));
    renderTeams();
    expect(await screen.findByText("Failed to load teams")).toBeInTheDocument();
  });

  test("the modal Cancel button is disabled while the delete is in flight", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/users?")) return Promise.resolve(usersPage(SEED_MANAGERS));
      if (method === "DELETE" && /^\/api\/teams\/\d+$/.test(url)) return new Promise(() => {});
      if (url.startsWith("/api/teams?")) return Promise.resolve(teamsPage(SEED_TEAMS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderTeams();

    await user.click(await screen.findByRole("button", { name: /delete mobile/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    expect(within(dialog).getByRole("button", { name: /cancel/i })).toBeDisabled();
  });

  test("shows 'No teams' empty state when the API returns zero items", async () => {
    setupMocks(mockFetch, () => teamsPage([], 0));
    renderTeams();

    expect(await screen.findByText(/no teams/i)).toBeInTheDocument();
  });

  test("admin sees a 'Create team' link below the table pointing at /teams/new", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    renderTeams();

    await screen.findByRole("cell", { name: "Platform" });
    const link = screen.getByRole("link", { name: /create team/i });
    expect(link).toHaveAttribute("href", "/teams/new");
  });

  test("non-admin does not see a 'Create team' link", async () => {
    localStorage.setItem(ROLE_KEY, "USER");
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    renderTeams();

    await screen.findByRole("cell", { name: "Platform" });
    expect(screen.queryByRole("link", { name: /create team/i })).not.toBeInTheDocument();
  });

  test("shows '(deleted)' suffix when the manager is soft-deleted", async () => {
    setupMocks(mockFetch, () =>
      teamsPage([
        { id: 99, name: "Orphan", managerId: 42, managerName: "Zed", managerDeleted: true },
      ]),
    );
    renderTeams();

    expect(await screen.findByRole("cell", { name: /^Zed \(deleted\)$/ })).toBeInTheDocument();
  });

  test("admin sees a Delete button in each row", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    renderTeams();

    await screen.findByRole("cell", { name: "Platform" });
    expect(screen.getAllByRole("button", { name: /^delete /i })).toHaveLength(2);
  });

  test("admin sees a Members link per row pointing at /teams/:id/members", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    renderTeams();

    await screen.findByRole("cell", { name: "Platform" });
    const links = screen.getAllByRole("link", { name: /^members of /i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/teams/1/members");
  });

  test("non-admin sees Members links but not Edit or Delete controls", async () => {
    localStorage.setItem(ROLE_KEY, "USER");
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    renderTeams();

    await screen.findByRole("cell", { name: "Platform" });
    const links = screen.getAllByRole("link", { name: /^members of /i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/teams/1/members");
    // The read-only roster is the only action available to non-admins.
    expect(screen.queryByRole("link", { name: /^edit /i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete /i })).not.toBeInTheDocument();
  });

  test("non-admin does not see Delete buttons", async () => {
    localStorage.setItem(ROLE_KEY, "USER");
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    renderTeams();

    await screen.findByRole("cell", { name: "Platform" });
    expect(screen.queryByRole("button", { name: /^delete /i })).not.toBeInTheDocument();
  });

  test("Cancel in the confirmation modal closes it without calling DELETE", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    const user = userEvent.setup();
    renderTeams();

    await user.click(await screen.findByRole("button", { name: /delete mobile/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const deleteCall = mockFetch.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
    );
    expect(deleteCall).toBeUndefined();
  });

  test("confirming triggers DELETE and refetches the list", async () => {
    let teamGetCount = 0;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/users?")) {
        return Promise.resolve(usersPage(SEED_MANAGERS));
      }
      if (method === "DELETE" && /^\/api\/teams\/\d+$/.test(url)) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.startsWith("/api/teams?")) {
        teamGetCount++;
        const items = teamGetCount === 1 ? SEED_TEAMS : [SEED_TEAMS[0]];
        return Promise.resolve(teamsPage(items));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderTeams();

    await user.click(await screen.findByRole("button", { name: /delete mobile/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(screen.queryByRole("cell", { name: "Mobile" })).not.toBeInTheDocument());

    const deleteCall = mockFetch.mock.calls.find(
      ([url, init]) =>
        (init as RequestInit | undefined)?.method === "DELETE" &&
        typeof url === "string" &&
        url === "/api/teams/2",
    );
    expect(deleteCall).toBeDefined();
    expect(teamGetCount).toBeGreaterThanOrEqual(2);
  });

  test("server error surfaces an alert and keeps the modal open", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/users?")) {
        return Promise.resolve(usersPage(SEED_MANAGERS));
      }
      if (method === "DELETE" && /^\/api\/teams\/\d+$/.test(url)) {
        return Promise.resolve(jsonResponse(500, { error: "internal", message: "boom" }));
      }
      if (url.startsWith("/api/teams?")) {
        return Promise.resolve(teamsPage(SEED_TEAMS));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderTeams();

    await user.click(await screen.findByRole("button", { name: /delete mobile/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    expect(await within(dialog).findByText(/failed to delete team/i)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
