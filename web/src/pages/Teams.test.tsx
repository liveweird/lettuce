import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import Teams from "./Teams";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";

type FetchMock = ReturnType<typeof vi.fn>;


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

const SEED_TEAMS = [
  { id: 1, name: "Platform", managerId: 10, managerName: "Alice Manager" },
  { id: 2, name: "Mobile", managerId: 11, managerName: "Bob Manager" },
];

// The page reads NO users pool since v4.15.0 (F9) — the manager filter is built from the
// all-teams rows — so a `/api/v1/users` request is unmocked (404) and asserted absent.
function setupMocks(mockFetch: FetchMock, teamsByUrl: (url: string) => Response) {
  mockFetch.mockImplementation((url: string) => {
    if (url.startsWith("/api/v1/teams")) return Promise.resolve(teamsByUrl(url));
    return Promise.resolve(jsonResponse(404, {}));
  });
}

function renderTeams() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider env="test">
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
    localStorage.setItem(ROLE_KEY, JSON.stringify(["ADMIN"]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders rows showing team name and manager name", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    renderTeams();

    expect(await screen.findByText("Platform")).toBeInTheDocument();
    expect(screen.getByText("Mobile")).toBeInTheDocument();
    expect(screen.getByText("Alice Manager")).toBeInTheDocument();
    expect(screen.getByText("Bob Manager")).toBeInTheDocument();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/teams\?/),
      expect.any(Object),
    );
  });

  test("typing in the Name filter triggers a refetch with name=", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    const user = userEvent.setup();
    renderTeams();

    await screen.findByText("Platform");
    await user.click(screen.getByRole("button", { name: /filters/i }));
    await user.type(screen.getByLabelText(/name/i), "Mobi");

    await waitFor(
      () => {
        const called = mockFetch.mock.calls.some(([url]) =>
          typeof url === "string" && url.startsWith("/api/v1/teams?") && url.includes("name=Mobi"),
        );
        expect(called).toBe(true);
      },
      { timeout: 1500 },
    );
  });

  test("filters are collapsed by default and the toggle reveals them", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    const user = userEvent.setup();
    renderTeams();

    await screen.findByText("Platform");
    const toggle = screen.getByRole("button", { name: /filters/i });
    // Collapsed by default — the toggle reports it and the space-eating filter row is hidden.
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Name")).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("the Filters toggle shows a badge counting the active filters", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    const user = userEvent.setup();
    renderTeams();

    await screen.findByText("Platform");
    const toggle = screen.getByRole("button", { name: /filters/i });
    expect(within(toggle).queryByText("1")).not.toBeInTheDocument();

    await user.click(toggle);
    await user.type(screen.getByLabelText("Name"), "Mobi");
    expect(within(toggle).getByText("1")).toBeInTheDocument();
  });

  test("pagination button click triggers a GET with page=2", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS, 25));
    const user = userEvent.setup();
    renderTeams();

    await screen.findByText("Platform");
    await user.click(screen.getByRole("button", { name: "2" }));

    await waitFor(() => {
      const called = mockFetch.mock.calls.some(([url]) =>
        typeof url === "string" && url.startsWith("/api/v1/teams?") && url.includes("page=2"),
      );
      expect(called).toBe(true);
    });
  });

  test("the manager filter lists the current managers from the all-teams rows — no users pool (F9, v4.15.0)", async () => {
    // A third team of Alice's repeats her manager: the options are DISTINCT managers.
    setupMocks(mockFetch, () =>
      teamsPage([...SEED_TEAMS, { id: 3, name: "Infra", managerId: 10, managerName: "Alice Manager" }]),
    );
    renderTeams();

    await screen.findByText("Platform");

    await waitFor(() => {
      const allTeamsCall = mockFetch.mock.calls.find(
        ([url]) =>
          typeof url === "string" && url.startsWith("/api/v1/teams?") && url.includes("pageSize=100"),
      );
      expect(allTeamsCall).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    const managerSelect = screen.getByLabelText(/manager/i, { selector: "input" });
    await waitFor(() => expect(managerSelect).not.toBeDisabled());
    fireEvent.click(managerSelect);
    // Alice manages two teams but is ONE option.
    expect(await screen.findAllByRole("option", { name: "Alice Manager", hidden: true })).toHaveLength(1);
    expect(screen.getByRole("option", { name: "Bob Manager", hidden: true })).toBeInTheDocument();
    // The directory is never paged for the filter.
    expect(mockFetch.mock.calls.some(([url]) => String(url).startsWith("/api/v1/users"))).toBe(false);
  });

  test("a stored manager filter who no longer manages any team is dropped once the teams have loaded", async () => {
    localStorage.setItem("lettuce.viewSettings.teams.filter.managerId", "42");
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    renderTeams();

    await screen.findByText("Platform");
    // No orphan filter: the list is not pinned to the gone manager and the badge counts nothing.
    await waitFor(() => {
      const listCalls = mockFetch.mock.calls.filter(
        ([url]) =>
          typeof url === "string" && url.startsWith("/api/v1/teams?") && !url.includes("pageSize=100"),
      );
      expect(listCalls.some(([url]) => String(url).includes("managerId=42"))).toBe(true);
      expect(String(listCalls[listCalls.length - 1][0])).not.toContain("managerId=");
    });
    expect(within(screen.getByRole("button", { name: /filters/i })).queryByText("1")).not.toBeInTheDocument();
  });

  test("a stored manager filter who still manages a team stands", async () => {
    localStorage.setItem("lettuce.viewSettings.teams.filter.managerId", "10");
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    renderTeams();

    await screen.findByText("Platform");
    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2));
    const listCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === "string" && url.startsWith("/api/v1/teams?") && !url.includes("pageSize=100"),
    );
    expect(listCalls.every(([url]) => String(url).includes("managerId=10"))).toBe(true);
    expect(within(screen.getByRole("button", { name: /filters/i })).getByText("1")).toBeInTheDocument();
  });

  test("clearing the Name filter empties the input", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    const user = userEvent.setup();
    renderTeams();

    await screen.findByText("Platform");
    await user.click(screen.getByRole("button", { name: /filters/i }));
    const nameInput = screen.getByLabelText(/name/i);
    await user.type(nameInput, "Mobi");
    await user.click(await screen.findByRole("button", { name: /clear name filter/i }));
    expect(nameInput).toHaveValue("");
  });

  test("selecting a Manager filter refetches with managerId=", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    renderTeams();

    await screen.findByText("Platform");
    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(screen.getByLabelText(/manager/i, { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "Alice Manager", hidden: true }));
    await waitFor(() => {
      const called = mockFetch.mock.calls.some(
        ([url]) =>
          typeof url === "string" && url.startsWith("/api/v1/teams?") && url.includes("managerId=10"),
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
          typeof url === "string" && url.startsWith("/api/v1/teams?") && url.includes("sort=-name"),
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
          url.startsWith("/api/v1/teams?") &&
          url.includes("pageSize=40") &&
          url.includes("page=1"),
      );
      expect(called).toBe(true);
    });
  });

  test("admin sees an Edit link per row pointing at /teams/:id/edit", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    renderTeams();

    await screen.findByText("Platform");
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
      if (method === "DELETE" && /^\/api\/v1\/teams\/\d+$/.test(url)) return new Promise(() => {});
      if (url.startsWith("/api/v1/teams?")) return Promise.resolve(teamsPage(SEED_TEAMS));
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderTeams();

    // Delete lives in the row's ⋯ menu (v3.4.0) — the accessible name is unchanged.
    await user.click(await screen.findByRole("button", { name: "More actions for Mobile" }));
    await user.click(await screen.findByRole("menuitem", { name: /delete mobile/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    expect(within(dialog).getByRole("button", { name: /cancel/i })).toBeDisabled();
  });

  test("shows 'No teams' empty state when the API returns zero items", async () => {
    setupMocks(mockFetch, () => teamsPage([], 0));
    renderTeams();

    expect(await screen.findByText(/no teams/i)).toBeInTheDocument();
  });

  test("admin sees a 'New team' link below the table pointing at /teams/new", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    renderTeams();

    await screen.findByText("Platform");
    const link = screen.getByRole("link", { name: /new team/i });
    expect(link).toHaveAttribute("href", "/teams/new");
  });

  test("non-admin does not see a 'New team' link", async () => {
    localStorage.setItem(ROLE_KEY, "[]");
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    renderTeams();

    await screen.findByText("Platform");
    expect(screen.queryByRole("link", { name: /new team/i })).not.toBeInTheDocument();
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

  test("each manager chip carries a User details link with the teams origin", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    renderTeams();

    const links = await screen.findAllByRole("link", { name: /^user details for /i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/users/10/details?name=Alice+Manager&from=teams");
    expect(links[1]).toHaveAttribute("href", "/users/11/details?name=Bob+Manager&from=teams");
  });

  test("no User details link for a deleted manager or one's own persona", async () => {
    localStorage.setItem("lettuce.auth.userId", "10"); // the caller IS Alice Manager
    setupMocks(mockFetch, () =>
      teamsPage([
        ...SEED_TEAMS,
        { id: 99, name: "Orphan", managerId: 42, managerName: "Zed", managerDeleted: true },
      ]),
    );
    renderTeams();

    await screen.findByText("Bob Manager");
    // Only Bob's row qualifies: Alice's row is the caller's own persona, Zed is deleted.
    const links = screen.getAllByRole("link", { name: /^user details for /i });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", expect.stringContaining("/users/11/details"));
  });

  test("admin sees a Delete item in each row's ⋯ menu", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    const user = userEvent.setup();
    renderTeams();

    await screen.findByText("Platform");
    expect(screen.getAllByRole("button", { name: /^more actions for /i })).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "More actions for Platform" }));
    expect(await screen.findByRole("menuitem", { name: "Delete Platform" })).toBeInTheDocument();
  });

  test("each team name is a link to the team-details view (v2.5.4 — no Members button)", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    renderTeams();

    await screen.findByText("Platform");
    const links = screen.getAllByRole("link", { name: /^team details for /i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/teams/1/details");
    expect(screen.queryByRole("link", { name: /^members of /i })).not.toBeInTheDocument();
  });

  test("non-admin sees the team-name links but no Edit or Delete controls at all", async () => {
    localStorage.setItem(ROLE_KEY, "[]");
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    renderTeams();

    await screen.findByText("Platform");
    const links = screen.getAllByRole("link", { name: /^team details for /i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/teams/1/details");
    // Non-admin rows carry no action buttons — the name link is the only affordance.
    expect(screen.queryByRole("link", { name: /^edit /i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^more actions for /i })).not.toBeInTheDocument();
  });

  test("non-admin does not see the ⋯ menus", async () => {
    localStorage.setItem(ROLE_KEY, "[]");
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    renderTeams();

    await screen.findByText("Platform");
    expect(screen.queryByRole("button", { name: /^more actions for /i })).not.toBeInTheDocument();
  });

  test("Cancel in the confirmation modal closes it without calling DELETE", async () => {
    setupMocks(mockFetch, () => teamsPage(SEED_TEAMS));
    const user = userEvent.setup();
    renderTeams();

    // Delete lives in the row's ⋯ menu (v3.4.0) — the accessible name is unchanged.
    await user.click(await screen.findByRole("button", { name: "More actions for Mobile" }));
    await user.click(await screen.findByRole("menuitem", { name: /delete mobile/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const deleteCall = mockFetch.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
    );
    expect(deleteCall).toBeUndefined();
  });

  test("confirming triggers DELETE and refetches the list", async () => {
    const toast = vi.spyOn(notifications, "show").mockReturnValue("id");
    let teamGetCount = 0;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE" && /^\/api\/v1\/teams\/\d+$/.test(url)) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      // The all-teams read behind the manager filter (pageSize=100) is not the page's list.
      if (url.startsWith("/api/v1/teams?") && url.includes("pageSize=100")) {
        return Promise.resolve(teamsPage(SEED_TEAMS));
      }
      if (url.startsWith("/api/v1/teams?")) {
        teamGetCount++;
        const items = teamGetCount === 1 ? SEED_TEAMS : [SEED_TEAMS[0]];
        return Promise.resolve(teamsPage(items));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderTeams();

    // Delete lives in the row's ⋯ menu (v3.4.0) — the accessible name is unchanged.
    await user.click(await screen.findByRole("button", { name: "More actions for Mobile" }));
    await user.click(await screen.findByRole("menuitem", { name: /delete mobile/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(screen.queryByRole("cell", { name: "Mobile" })).not.toBeInTheDocument());

    const deleteCall = mockFetch.mock.calls.find(
      ([url, init]) =>
        (init as RequestInit | undefined)?.method === "DELETE" &&
        typeof url === "string" &&
        url === "/api/v1/teams/2",
    );
    expect(deleteCall).toBeDefined();
    expect(teamGetCount).toBeGreaterThanOrEqual(2);
    // The shared delete hook shows the page's fixed success message as a toast.
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Team deleted", color: "teal" }),
    );
    toast.mockRestore();
  });

  test("server error surfaces an alert and keeps the modal open", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE" && /^\/api\/v1\/teams\/\d+$/.test(url)) {
        return Promise.resolve(jsonResponse(500, { error: "internal", message: "boom" }));
      }
      if (url.startsWith("/api/v1/teams?")) {
        return Promise.resolve(teamsPage(SEED_TEAMS));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderTeams();

    // Delete lives in the row's ⋯ menu (v3.4.0) — the accessible name is unchanged.
    await user.click(await screen.findByRole("button", { name: "More actions for Mobile" }));
    await user.click(await screen.findByRole("menuitem", { name: /delete mobile/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    expect(await within(dialog).findByText(/failed to delete team/i)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
