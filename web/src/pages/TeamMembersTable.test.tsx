import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, renderWithProviders, screen, waitFor, within } from "../test/render";
import TeamMembersTable from "./TeamMembersTable";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

type TeamMemberItem = {
  userId: number;
  name: string;
  email: string;
  teamId: number;
  teamName: string;
};


function membersPage(items: TeamMemberItem[], total = items.length): Response {
  return jsonResponse(200, { items, page: 1, pageSize: 20, total });
}

const SEED_MEMBERS: TeamMemberItem[] = [
  { userId: 10, name: "Alice Adams", email: "alice@x.test", teamId: 3, teamName: "Platform" },
  { userId: 11, name: "Bob Brown", email: "bob@x.test", teamId: 4, teamName: "Support" },
  // Same user in a second shared team — must render as its own row.
  { userId: 10, name: "Alice Adams", email: "alice@x.test", teamId: 4, teamName: "Support" },
];

const SEED_TEAMS = [
  { id: 3, name: "Platform", managerId: 1, managerName: "Mona", managerDeleted: false },
  { id: 4, name: "Support", managerId: 1, managerName: "Mona", managerDeleted: false },
];

function teamsPage(): Response {
  return jsonResponse(200, { items: SEED_TEAMS, page: 1, pageSize: 100, total: SEED_TEAMS.length });
}

function setupMocks(mockFetch: FetchMock, response: Response = membersPage(SEED_MEMBERS)) {
  mockFetch.mockImplementation((url: string) => {
    const path = String(url);
    if (path.startsWith("/api/v1/teams/members")) return Promise.resolve(response.clone());
    if (path.startsWith("/api/v1/teams")) return Promise.resolve(teamsPage());
    return Promise.resolve(jsonResponse(404, {}));
  });
}

function memberUrls(mockFetch: FetchMock): string[] {
  return mockFetch.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith("/api/v1/teams/members"));
}

describe("TeamMembersTable", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "USER");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders rows with name, email and team; fetches view=member with sort=name", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<TeamMembersTable view="member" emptyMessage="No teammates" />);

    expect(await screen.findByRole("cell", { name: "Bob Brown" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "bob@x.test" })).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "Alice Adams" })).toHaveLength(2);
    expect(screen.getByRole("cell", { name: "Platform" })).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "Support" })).toHaveLength(2);

    const urls = memberUrls(mockFetch);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls[0]).toContain("view=member");
    expect(urls[0]).toContain("sort=name");
  });

  test("fetches view=managed when configured", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<TeamMembersTable view="managed" emptyMessage="No team members" />);

    await screen.findByRole("cell", { name: "Bob Brown" });
    expect(memberUrls(mockFetch)[0]).toContain("view=managed");
  });

  test("renders a Provide feedback link per row pointing at /feedback/new", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<TeamMembersTable view="member" emptyMessage="No teammates" />);

    const link = await screen.findByRole("link", { name: /provide feedback to bob brown/i });
    expect(link).toHaveAttribute(
      "href",
      `/feedback/new?subjectId=11&subjectName=Bob%20Brown&back=${encodeURIComponent("/?tab=peers")}`,
    );
    // One link per row (Alice appears in two teams -> two rows -> three links total).
    expect(screen.getAllByRole("link", { name: /provide feedback to/i })).toHaveLength(3);
  });

  test("managed view adds a Request feedback link per row pointing at /feedback/request", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<TeamMembersTable view="managed" emptyMessage="No team members" />);

    const link = await screen.findByRole("link", { name: /request feedback about bob brown/i });
    expect(link).toHaveAttribute(
      "href",
      `/feedback/request?subjectId=11&subjectName=Bob%20Brown&back=${encodeURIComponent("/?tab=subordinates")}`,
    );
    // One per row (Alice appears in two teams -> two rows -> three links total).
    expect(screen.getAllByRole("link", { name: /request feedback about/i })).toHaveLength(3);
  });

  test("managed view adds an Ask for feedback link per row pointing at /feedback/ask", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<TeamMembersTable view="managed" emptyMessage="No team members" />);

    const link = await screen.findByRole("link", { name: /ask bob brown for feedback/i });
    expect(link).toHaveAttribute(
      "href",
      `/feedback/ask?providerId=11&providerName=Bob%20Brown&back=${encodeURIComponent("/?tab=subordinates")}`,
    );
    // One per row (Alice appears in two teams -> two rows -> three links total).
    expect(screen.getAllByRole("link", { name: /ask .* for feedback/i })).toHaveLength(3);
  });

  test("member view adds an Ask for feedback link per row pointing at /feedback/ask", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<TeamMembersTable view="member" emptyMessage="No teammates" />);

    const link = await screen.findByRole("link", { name: /ask bob brown for feedback/i });
    expect(link).toHaveAttribute(
      "href",
      `/feedback/ask?providerId=11&providerName=Bob%20Brown&back=${encodeURIComponent("/?tab=peers")}`,
    );
    expect(screen.getAllByRole("link", { name: /ask .* for feedback/i })).toHaveLength(3);
  });

  test("member view does not render Request feedback links", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<TeamMembersTable view="member" emptyMessage="No teammates" />);

    await screen.findByRole("cell", { name: "Bob Brown" });
    expect(screen.queryByRole("link", { name: /request feedback about/i })).not.toBeInTheDocument();
  });

  test("member view adds a Feedbacks link per row pointing at the per-user screen", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<TeamMembersTable view="member" emptyMessage="No teammates" />);

    const link = await screen.findByRole("link", { name: /feedbacks with bob brown/i });
    expect(link).toHaveAttribute(
      "href",
      "/users/11/feedbacks?name=Bob%20Brown&from=peers",
    );
    // One per row (Alice appears in two teams -> two rows -> three links total).
    expect(screen.getAllByRole("link", { name: /feedbacks with/i })).toHaveLength(3);
  });

  test("managed view also renders a Feedbacks link per row, scoped from=subordinates", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<TeamMembersTable view="managed" emptyMessage="No team members" />);

    const link = await screen.findByRole("link", { name: /feedbacks with bob brown/i });
    expect(link).toHaveAttribute(
      "href",
      "/users/11/feedbacks?name=Bob%20Brown&from=subordinates",
    );
    // One per row (Alice appears in two teams -> two rows -> three links total).
    expect(screen.getAllByRole("link", { name: /feedbacks with/i })).toHaveLength(3);
  });

  test("typing in the Name filter triggers a debounced refetch and the clear button resets it", async () => {
    setupMocks(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<TeamMembersTable view="member" emptyMessage="No teammates" />);

    await screen.findByRole("cell", { name: "Bob Brown" });
    await user.click(screen.getByRole("button", { name: /filters/i }));
    await user.type(screen.getByLabelText("Name"), "ali");

    await waitFor(
      () => {
        expect(memberUrls(mockFetch).some((url) => url.includes("name=ali"))).toBe(true);
      },
      { timeout: 1500 },
    );

    await user.click(screen.getByLabelText("Clear name filter"));
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  test("filters are collapsed by default and the toggle reveals them", async () => {
    setupMocks(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<TeamMembersTable view="member" emptyMessage="No teammates" />);

    await screen.findByRole("cell", { name: "Bob Brown" });
    const toggle = screen.getByRole("button", { name: /filters/i });
    // Collapsed by default — the toggle reports it and the space-eating filter row is hidden.
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.type(screen.getByLabelText("Name"), "ali");
    expect(screen.getByLabelText("Name")).toHaveValue("ali");

    // Toggling again collapses it.
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("the Filters toggle shows a badge counting the active filters", async () => {
    setupMocks(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<TeamMembersTable view="member" emptyMessage="No teammates" />);

    await screen.findByRole("cell", { name: "Bob Brown" });
    const toggle = screen.getByRole("button", { name: /filters/i });
    // No filters set → no badge.
    expect(within(toggle).queryByText("1")).not.toBeInTheDocument();

    await user.click(toggle);
    await user.type(screen.getByLabelText("Name"), "ali");
    expect(within(toggle).getByText("1")).toBeInTheDocument();
  });

  test("typing in the Email filter adds email=", async () => {
    setupMocks(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<TeamMembersTable view="member" emptyMessage="No teammates" />);

    await screen.findByRole("cell", { name: "Bob Brown" });
    await user.click(screen.getByRole("button", { name: /filters/i }));
    await user.type(screen.getByLabelText("Email"), "bob@");
    await waitFor(
      () => {
        expect(memberUrls(mockFetch).some((url) => url.includes("email=bob%40"))).toBe(true);
      },
      { timeout: 1500 },
    );
  });

  test("the Team dropdown lists all teams", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<TeamMembersTable view="member" emptyMessage="No teammates" />);

    await screen.findByRole("cell", { name: "Bob Brown" });
    fireEvent.click(screen.getByRole("button", { name: /filters/i }));

    // happy-dom does not open Mantine comboboxes via userEvent's pointer simulation
    fireEvent.click(screen.getByLabelText("Team", { selector: "input" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Platform", "Support"]);
  });

  test("picking a team filters by teamId and clearing removes the filter", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<TeamMembersTable view="member" emptyMessage="No teammates" />);

    await screen.findByRole("cell", { name: "Bob Brown" });
    fireEvent.click(screen.getByRole("button", { name: /filters/i }));

    fireEvent.click(screen.getByLabelText("Team", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "Support" }));
    await waitFor(() => {
      expect(memberUrls(mockFetch).some((url) => url.includes("teamId=4"))).toBe(true);
    });

    const requestsBeforeClear = memberUrls(mockFetch).length;
    fireEvent.click(screen.getByLabelText("Clear team filter"));
    await waitFor(() => {
      const later = memberUrls(mockFetch).slice(requestsBeforeClear);
      expect(later.length).toBeGreaterThan(0);
      expect(later.every((url) => !url.includes("teamId="))).toBe(true);
    });
  });

  test("clicking the Team header sorts by teamName, clicking again descends", async () => {
    setupMocks(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<TeamMembersTable view="member" emptyMessage="No teammates" />);

    await screen.findByRole("cell", { name: "Bob Brown" });
    await user.click(screen.getByRole("button", { name: /team/i }));
    await waitFor(() => {
      expect(memberUrls(mockFetch).some((url) => url.includes("sort=teamName"))).toBe(true);
    });

    await user.click(screen.getByRole("button", { name: /team/i }));
    await waitFor(() => {
      expect(memberUrls(mockFetch).some((url) => url.includes("sort=-teamName"))).toBe(true);
    });
  });

  test("pagination and page size controls update the query", async () => {
    setupMocks(mockFetch, membersPage(SEED_MEMBERS, 45));
    const user = userEvent.setup();
    renderWithProviders(<TeamMembersTable view="member" emptyMessage="No teammates" />);

    await screen.findByRole("cell", { name: "Bob Brown" });
    expect(screen.getByText("45 total")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "2" }));
    await waitFor(() => {
      expect(memberUrls(mockFetch).some((url) => url.includes("page=2"))).toBe(true);
    });

    fireEvent.click(screen.getByLabelText("Rows per page", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "40 / page" }));
    await waitFor(() => {
      const url = memberUrls(mockFetch).find((u) => u.includes("pageSize=40"));
      expect(url).toBeDefined();
      expect(url).toContain("page=1");
    });
  });

  test("shows the configured empty state", async () => {
    setupMocks(mockFetch, membersPage([]));
    renderWithProviders(<TeamMembersTable view="managed" emptyMessage="No team members" />);

    expect(await screen.findByText("No team members")).toBeInTheDocument();
  });

  test("shows an error alert when the request fails", async () => {
    setupMocks(mockFetch, jsonResponse(500, { error: "internal", message: "boom" }));
    renderWithProviders(<TeamMembersTable view="member" emptyMessage="No teammates" />);

    expect(await screen.findByText(/failed to load team members/i)).toBeInTheDocument();
  });

  test("rows are ordered as returned by the API", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<TeamMembersTable view="member" emptyMessage="No teammates" />);

    await screen.findByRole("cell", { name: "Bob Brown" });
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Platform")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Bob Brown")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Alice Adams")).toBeInTheDocument();
  });
});
