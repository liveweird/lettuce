import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, renderWithProviders, screen, waitFor, within } from "../test/render";
import TeamMembersTable from "./TeamMembersTable";
import { jsonResponse } from "../test/http";

// The account-status filter (Any / Active / Inactive, default Active) and the Inactive pill on
// the person cards — split from TeamMembersTable.test.tsx to stay under the per-function size
// backstop (the FeedbackTable.team.test.tsx precedent).

type FetchMock = ReturnType<typeof vi.fn>;

type Item = {
  userId: number;
  name: string;
  email: string;
  teamId: number;
  teamName: string;
  deactivated?: boolean;
};

const SEED: Item[] = [
  { userId: 10, name: "Alice Adams", email: "alice@x.test", teamId: 3, teamName: "Platform" },
  { userId: 11, name: "Bob Brown", email: "bob@x.test", teamId: 4, teamName: "Support" },
];

function membersPage(items: Item[]): Response {
  return jsonResponse(200, { items, page: 1, pageSize: 20, total: items.length });
}

function setupMocks(mockFetch: FetchMock, items: Item[] = SEED) {
  mockFetch.mockImplementation((url: string) => {
    const path = String(url);
    if (path.startsWith("/api/v1/teams/members")) return Promise.resolve(membersPage(items));
    if (path.startsWith("/api/v1/succession-plans") || path.startsWith("/api/v1/teams")) {
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 100, total: 0 }));
    }
    return Promise.resolve(jsonResponse(404, {}));
  });
}

function memberUrls(mockFetch: FetchMock): string[] {
  return mockFetch.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith("/api/v1/teams/members"));
}

describe("TeamMembersTable account-status filter", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.userId", "1");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("the Status filter defaults to Active (deactivated=false, not counted as an applied filter) and Any drops the param", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<TeamMembersTable view="member" emptyMessage="No teammates" />);

    await screen.findByText("Bob Brown");
    expect(memberUrls(mockFetch).every((url) => url.includes("deactivated=false"))).toBe(true);

    const toggle = screen.getByRole("button", { name: /filters/i });
    // The default is not an applied filter: no badge.
    expect(within(toggle).queryByText("1")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    const status = screen.getByLabelText("Status", { selector: "input" });
    expect(status).toHaveValue("Active");

    // Inactive → deactivated=true, and now the badge counts it.
    fireEvent.click(status);
    fireEvent.click(await screen.findByRole("option", { name: "Inactive" }));
    await waitFor(() => {
      expect(memberUrls(mockFetch).some((url) => url.includes("deactivated=true"))).toBe(true);
    });
    expect(within(toggle).getByText("1")).toBeInTheDocument();

    // Any (the deselected Select) sends no deactivated param at all; the choice persists.
    const before = memberUrls(mockFetch).length;
    fireEvent.click(status);
    fireEvent.click(await screen.findByRole("option", { name: "Inactive" })); // re-pick = deselect
    await waitFor(() => {
      const later = memberUrls(mockFetch).slice(before);
      expect(later.length).toBeGreaterThan(0);
      expect(later.every((url) => !url.includes("deactivated"))).toBe(true);
    });
    expect(localStorage.getItem("lettuce.viewSettings.teamMembers.member.filter.accountStatus")).toBe("null");
  });

  test("a stored Inactive choice wins over the Active default", async () => {
    localStorage.setItem("lettuce.viewSettings.teamMembers.member.filter.accountStatus", JSON.stringify("true"));
    setupMocks(mockFetch);
    renderWithProviders(<TeamMembersTable view="member" emptyMessage="No teammates" />);

    await screen.findByText("Bob Brown");
    expect(memberUrls(mockFetch).every((url) => url.includes("deactivated=true"))).toBe(true);
  });

  test("a deactivated person's card carries the Inactive pill; active cards do not", async () => {
    setupMocks(mockFetch, [SEED[0], { ...SEED[1], deactivated: true }]);
    renderWithProviders(<TeamMembersTable view="member" emptyMessage="No teammates" />);

    const bob = (await screen.findByText("Bob Brown")).closest("li") as HTMLElement;
    expect(within(bob).getByText("Inactive")).toBeInTheDocument();
    const alice = screen.getByText("Alice Adams").closest("li") as HTMLElement;
    expect(within(alice).queryByText("Inactive")).not.toBeInTheDocument();
  });

  test("a deactivated card in the managed view hides the create actions and keeps the read ones", async () => {
    setupMocks(mockFetch, [SEED[0], { ...SEED[1], deactivated: true }]);
    renderWithProviders(<TeamMembersTable view="managed" emptyMessage="No team members" />);

    await screen.findByText("Bob Brown");
    // The active card keeps its feedback dropdown (create + list) and the New 1:1 action…
    expect(screen.getByRole("button", { name: "Feedback actions for Alice Adams" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1:1 actions for Alice Adams" })).toBeInTheDocument();
    // …the deactivated one has no create entry point at all, only the read drill-downs
    // (a lone member, so the feedback dropdown collapses to the plain list link).
    expect(screen.queryByRole("button", { name: "Feedback actions for Bob Brown" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "1:1 actions for Bob Brown" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New 1:1 with Bob Brown" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Request feedback about Bob Brown" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Feedbacks with Bob Brown" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "1:1 meetings with Bob Brown" })).toBeInTheDocument();
  });

  test("an empty list under the default Active filter hints that inactive people are hidden", async () => {
    setupMocks(mockFetch, []);
    renderWithProviders(<TeamMembersTable view="member" emptyMessage="No teammates" />);

    expect(await screen.findByText("No teammates")).toBeInTheDocument();
    expect(screen.getByText(/Inactive people are hidden/)).toBeInTheDocument();
  });

  test("the hidden-inactive hint is absent once the filter is not the default", async () => {
    localStorage.setItem("lettuce.viewSettings.teamMembers.member.filter.accountStatus", JSON.stringify("true"));
    setupMocks(mockFetch, []);
    renderWithProviders(<TeamMembersTable view="member" emptyMessage="No teammates" />);

    expect(await screen.findByText("No teammates")).toBeInTheDocument();
    expect(screen.queryByText(/Inactive people are hidden/)).not.toBeInTheDocument();
  });
});
