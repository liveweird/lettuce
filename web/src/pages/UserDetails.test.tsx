import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import UserDetails from "./UserDetails";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";
const USER_ID_KEY = "lettuce.auth.userId";

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

function renderDetails(route = "/users/5/details?name=Bob&from=users") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/users/:userId/details" element={<UserDetails />} />
            <Route path="/users" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

type FetchMock = ReturnType<typeof vi.fn>;

type MemberRow = {
  userId: number;
  name: string;
  email: string;
  teamId: number;
  teamName: string;
  lastOneOnOneDate?: string | null;
  lastOneOnOneOpenItems?: number | null;
  lastFeedbackAt?: number | null;
  lastFeedbackGivenAt?: number | null;
  lastFeedbackReceivedAt?: number | null;
  activeGoalCount?: number | null;
};

const BOB_ROW: MemberRow = {
  userId: 5,
  name: "Bob",
  email: "bob@example.com",
  teamId: 7,
  teamName: "Platform",
};

// URL-routed mock covering every request the relationship resolution can make: the three
// caller-relative member views, the users list, and the id-keyed teams filter.
function mockApi(
  mockFetch: FetchMock,
  opts: {
    managers?: MemberRow[];
    managed?: MemberRow[];
    member?: MemberRow[];
    users?: Array<{ id: number; name: string; email: string; role: "ADMIN" | "USER" }>;
    teams?: Array<{ id: number; name: string }>;
  },
) {
  mockFetch.mockImplementation((url: string) => {
    const u = String(url);
    const page = (items: unknown[]) =>
      jsonResponse(200, { items, page: 1, pageSize: 100, total: items.length });
    if (u.startsWith("/api/v1/teams/members?")) {
      const view = new URL(u, "http://localhost").searchParams.get("view");
      const items =
        view === "managers" ? opts.managers : view === "managed" ? opts.managed : opts.member;
      return Promise.resolve(page(items ?? []));
    }
    if (u.startsWith("/api/v1/users?")) return Promise.resolve(page(opts.users ?? []));
    if (u.startsWith("/api/v1/teams?")) return Promise.resolve(page(opts.teams ?? []));
    return Promise.resolve(jsonResponse(404, {}));
  });
}

describe("UserDetails page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "USER");
    localStorage.setItem(USER_ID_KEY, "1");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("a user found in the managers view renders the manager-flavored card", async () => {
    mockApi(mockFetch, {
      managers: [{ ...BOB_ROW, lastOneOnOneDate: "2026-07-01", lastOneOnOneOpenItems: 2, activeGoalCount: 1 }],
    });
    renderDetails();

    expect(await screen.findByText("One of your managers")).toBeInTheDocument();
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
    expect(screen.getByText("Platform")).toBeInTheDocument();
    // The managers-tab stats block…
    expect(screen.getByText("Last 1:1")).toBeInTheDocument();
    expect(screen.getByText("Active goals")).toBeInTheDocument();
    // …and its actions, with the drill-downs carrying the managers origin.
    expect(screen.getByRole("link", { name: "Goals from Bob" })).toHaveAttribute(
      "href",
      "/users/5/goals?name=Bob&from=managers",
    );
    expect(screen.getByRole("link", { name: "1:1 meetings with Bob" })).toHaveAttribute(
      "href",
      "/users/5/one-on-ones?name=Bob&from=managers",
    );
    // Provide feedback returns here on Cancel via back=.
    expect(screen.getByRole("link", { name: "Provide feedback to Bob" })).toHaveAttribute(
      "href",
      `/feedback/new?subjectId=5&subjectName=Bob&back=${encodeURIComponent("/users/5/details?name=Bob&from=users")}`,
    );
    // No subordinate-only affordances on a manager card.
    expect(screen.queryByRole("link", { name: /new 1:1/i })).not.toBeInTheDocument();
  });

  test("a user found in the managed view renders the subordinate-flavored card", async () => {
    mockApi(mockFetch, {
      managed: [{ ...BOB_ROW, activeGoalCount: 0 }],
    });
    renderDetails();

    expect(await screen.findByText("One of your subordinates")).toBeInTheDocument();
    expect(screen.getByText("Last 1:1")).toBeInTheDocument();
    // The subordinate card carries the direct-report affordances.
    expect(screen.getByRole("link", { name: "New 1:1 with Bob" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request feedback about Bob" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Goals for Bob" })).toHaveAttribute(
      "href",
      "/users/5/goals?name=Bob&from=subordinates",
    );
  });

  test("a user found in the member view renders the peer-flavored card", async () => {
    mockApi(mockFetch, {
      member: [{ ...BOB_ROW, lastFeedbackGivenAt: 1_700_000_000_000, lastFeedbackReceivedAt: null }],
    });
    renderDetails();

    expect(await screen.findByText("One of your peers")).toBeInTheDocument();
    // The peers-tab stats block (two feedback directions), no 1:1/goal affordances.
    expect(screen.getByText("Feedback from me")).toBeInTheDocument();
    expect(screen.getByText("Feedback from them")).toBeInTheDocument();
    expect(screen.queryByText("Last 1:1")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /goals/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Feedbacks with Bob" })).toHaveAttribute(
      "href",
      "/users/5/feedbacks?name=Bob&from=peers",
    );
  });

  test("their-manager beats my-subordinate when both relationships exist", async () => {
    mockApi(mockFetch, {
      managers: [BOB_ROW],
      managed: [{ ...BOB_ROW, teamId: 8, teamName: "Other" }],
    });
    renderDetails();

    expect(await screen.findByText("One of your managers")).toBeInTheDocument();
    expect(screen.queryByText("One of your subordinates")).not.toBeInTheDocument();
  });

  test("an unrelated user still gets a card from the open users list, without stats", async () => {
    mockApi(mockFetch, {
      users: [{ id: 5, name: "Bob", email: "bob@example.com", role: "USER" }],
      teams: [{ id: 9, name: "Elsewhere" }],
    });
    renderDetails();

    expect(await screen.findByText("bob@example.com")).toBeInTheDocument();
    // Their teams still badge from the id-keyed teams filter.
    expect(screen.getByText("Elsewhere")).toBeInTheDocument();
    // No relationship hint and no stats the server didn't compute.
    expect(screen.queryByText(/one of your/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Feedback from me")).not.toBeInTheDocument();
    expect(screen.queryByText("Last 1:1")).not.toBeInTheDocument();
    // Feedback actions still apply to any user; the drill-down returns to the users list.
    expect(screen.getByRole("link", { name: "Feedbacks with Bob" })).toHaveAttribute(
      "href",
      "/users/5/feedbacks?name=Bob&from=users",
    );
  });

  test("shows the not-found state when the user exists nowhere", async () => {
    mockApi(mockFetch, {});
    renderDetails();

    expect(await screen.findByText("User not found.")).toBeInTheDocument();
  });

  test("viewing yourself renders the card without actions", async () => {
    localStorage.setItem(USER_ID_KEY, "5");
    mockApi(mockFetch, {
      users: [{ id: 5, name: "Bob", email: "bob@example.com", role: "USER" }],
    });
    renderDetails();

    expect(await screen.findByText("bob@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /provide feedback/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /feedbacks with/i })).not.toBeInTheDocument();
  });

  test("defaults the back link to the users list", async () => {
    mockApi(mockFetch, { managers: [BOB_ROW] });
    renderDetails();

    expect(await screen.findByRole("link", { name: "← Back to Users" })).toHaveAttribute(
      "href",
      "/users",
    );
  });

  test("the members origin links back to that team's roster", async () => {
    mockApi(mockFetch, { member: [BOB_ROW] });
    renderDetails("/users/5/details?name=Bob&from=members&teamId=3");

    expect(await screen.findByRole("link", { name: "← Back to Team members" })).toHaveAttribute(
      "href",
      "/teams/3/members",
    );
  });

  test("the teams origin links back to the teams list", async () => {
    mockApi(mockFetch, { managers: [BOB_ROW] });
    renderDetails("/users/5/details?name=Bob&from=teams");

    expect(await screen.findByRole("link", { name: "← Back to Teams" })).toHaveAttribute(
      "href",
      "/teams",
    );
  });

  test("a members origin without a teamId degrades to the users list", async () => {
    mockApi(mockFetch, { member: [BOB_ROW] });
    renderDetails("/users/5/details?name=Bob&from=members");

    expect(await screen.findByRole("link", { name: "← Back to Users" })).toHaveAttribute(
      "href",
      "/users",
    );
  });

  test("an invalid id redirects to the users list", async () => {
    mockApi(mockFetch, {});
    renderDetails("/users/nope/details");

    expect(await screen.findByTestId("probe")).toHaveTextContent("/users");
  });

  test("shows an alert when the lookup fails", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(jsonResponse(500, { error: "internal", message: "boom" })),
    );
    renderDetails();

    expect(await screen.findByText("Failed to load user")).toBeInTheDocument();
  });

  test("the heading uses the name param before the data lands, then the resolved name", async () => {
    mockApi(mockFetch, { managers: [BOB_ROW] });
    renderDetails();

    // The name param feeds the heading immediately (no getUser call — it is self-or-admin only).
    expect(screen.getByRole("heading", { name: "Bob" })).toBeInTheDocument();
    expect(await screen.findByText("One of your managers")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bob" })).toBeInTheDocument();
  });
});
