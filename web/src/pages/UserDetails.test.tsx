import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import UserDetails from "./UserDetails";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

// The default route's own URL, as every drill-down's encoded `back=` round-trip target.
const BACK_HERE = encodeURIComponent("/users/5/details?name=Bob&from=users");

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

// v1.51.0: the feedback/1:1 card actions live behind topic dropdowns — open the trigger,
// then assert on its role=menuitem entries (the Users.test.tsx idiom).
async function openCardMenu(name: RegExp | string) {
  await userEvent.setup().click(await screen.findByRole("button", { name }));
}

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
  careerPath?: { id: number; value: string } | null;
  careerSpecialization?: { id: number; value: string } | null;
  seniorityLevel?: { id: number; value: string } | null;
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
    users?: Array<{
      id: number;
      name: string;
      email: string;
      roles: Array<"ADMIN">;
      careerPath?: { id: number; value: string } | null;
      careerSpecialization?: { id: number; value: string } | null;
      seniorityLevel?: { id: number; value: string } | null;
    }>;
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
    localStorage.setItem(ROLE_KEY, "[]");
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
    // …and its actions, with the drill-downs returning HERE (from=details + back=, v1.39.0).
    expect(screen.getByRole("link", { name: "Goals from Bob" })).toHaveAttribute(
      "href",
      `/users/5/goals?name=Bob&from=details&back=${BACK_HERE}`,
    );
    expect(screen.getByRole("link", { name: "1:1 meetings with Bob" })).toHaveAttribute(
      "href",
      `/users/5/one-on-ones?name=Bob&from=details&back=${BACK_HERE}`,
    );
    // Provide feedback (behind the Feedback dropdown, v1.51.0) returns here on Cancel via back=.
    await openCardMenu(/feedback actions for bob/i);
    expect(
      await screen.findByRole("menuitem", { name: "Provide feedback to Bob" }),
    ).toHaveAttribute(
      "href",
      `/feedback/new?subjectId=5&subjectName=Bob&back=${encodeURIComponent("/users/5/details?name=Bob&from=users")}`,
    );
    // No subordinate-only affordances on a manager card — and with no New 1:1 the 1:1 group
    // stays a single plain button (asserted a link above), never a dropdown.
    expect(screen.queryByRole("link", { name: /new 1:1/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /new 1:1/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /1:1 actions for/i })).not.toBeInTheDocument();
  });

  test("a user found in the managed view renders the subordinate-flavored card", async () => {
    mockApi(mockFetch, {
      managed: [{ ...BOB_ROW, activeGoalCount: 0 }],
    });
    renderDetails();

    expect(await screen.findByText("One of your subordinates")).toBeInTheDocument();
    expect(screen.getByText("Last 1:1")).toBeInTheDocument();
    // The subordinate card carries the direct-report affordances, behind their dropdowns.
    await openCardMenu(/feedback actions for bob/i);
    expect(
      await screen.findByRole("menuitem", { name: "Request feedback about Bob" }),
    ).toBeInTheDocument();
    await openCardMenu(/1:1 actions for bob/i);
    expect(await screen.findByRole("menuitem", { name: "New 1:1 with Bob" })).toBeInTheDocument();
    // The drill-down returns here and asserts the relationship (`manages=1`) so the
    // manager-only affordances survive the details origin.
    expect(screen.getByRole("link", { name: "Goals for Bob" })).toHaveAttribute(
      "href",
      `/users/5/goals?name=Bob&from=details&back=${BACK_HERE}&manages=1`,
    );
    // The subordinate flavor carries all four labeled sections (v1.46.0); "Days off"
    // matches the caption AND the drill-down button's text.
    expect(screen.getByText("Profile")).toBeInTheDocument();
    expect(screen.getByText("Collaboration")).toBeInTheDocument();
    expect(screen.getByText("Performance")).toBeInTheDocument();
    expect(screen.getAllByText("Days off")).toHaveLength(2);
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
    await openCardMenu(/feedback actions for bob/i);
    expect(await screen.findByRole("menuitem", { name: "Feedbacks with Bob" })).toHaveAttribute(
      "href",
      `/users/5/feedbacks?name=Bob&from=details&back=${BACK_HERE}`,
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
      users: [{ id: 5, name: "Bob", email: "bob@example.com", roles: [] }],
      teams: [{ id: 9, name: "Elsewhere" }],
    });
    renderDetails();

    expect(await screen.findByText("bob@example.com")).toBeInTheDocument();
    // Their teams still badge from the id-keyed teams filter.
    expect(screen.getByText("Elsewhere")).toBeInTheDocument();
    // The fallback path's team badge links to team details too (v2.5.4).
    expect(screen.getByRole("link", { name: "Team details for Elsewhere" })).toHaveAttribute(
      "href",
      "/teams/9/details",
    );
    // No relationship hint and no stats the server didn't compute.
    expect(screen.queryByText(/one of your/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Feedback from me")).not.toBeInTheDocument();
    expect(screen.queryByText("Last 1:1")).not.toBeInTheDocument();
    // Feedback actions still apply to any user; the drill-down round-trips through here.
    await openCardMenu(/feedback actions for bob/i);
    expect(await screen.findByRole("menuitem", { name: "Feedbacks with Bob" })).toHaveAttribute(
      "href",
      `/users/5/feedbacks?name=Bob&from=details&back=${BACK_HERE}`,
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
      users: [{ id: 5, name: "Bob", email: "bob@example.com", roles: [] }],
    });
    renderDetails();

    expect(await screen.findByText("bob@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /provide feedback/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /feedbacks with/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /feedback actions for/i })).not.toBeInTheDocument();
    // With no stats and no buttons, only the Profile section renders (v1.46.0).
    expect(screen.getByText("Profile")).toBeInTheDocument();
    expect(screen.queryByText("Collaboration")).not.toBeInTheDocument();
    expect(screen.queryByText("Performance")).not.toBeInTheDocument();
    expect(screen.queryByText("Days off")).not.toBeInTheDocument();
  });

  test("an auditor viewer gets the Audit drill-downs on any card", async () => {
    localStorage.setItem(ROLE_KEY, JSON.stringify(["HR"]));
    // Bob is unrelated to the HR viewer — the audit section shows regardless of relationship.
    mockApi(mockFetch, { users: [{ id: 5, name: "Bob", email: "bob@example.com", roles: [] }] });
    renderDetails();

    expect(await screen.findByText("Audit")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Audit feedbacks of Bob" })).toHaveAttribute(
      "href",
      `/users/5/feedbacks?name=Bob&from=details&mode=audit&back=${BACK_HERE}`,
    );
    expect(screen.getByRole("link", { name: "Audit 1:1 meetings of Bob" })).toHaveAttribute(
      "href",
      `/users/5/one-on-ones?name=Bob&from=details&mode=audit&back=${BACK_HERE}`,
    );
    expect(screen.getByRole("link", { name: "Audit goals of Bob" })).toHaveAttribute(
      "href",
      `/users/5/goals?name=Bob&from=details&mode=audit&back=${BACK_HERE}`,
    );
    expect(screen.getByRole("link", { name: "Audit performance reviews of Bob" })).toHaveAttribute(
      "href",
      `/users/5/performance-reviews?name=Bob&from=details&mode=audit&back=${BACK_HERE}`,
    );
  });

  test("an auditor's audit block drops just a disabled feature's drill-down (v1.53.0)", async () => {
    localStorage.setItem(ROLE_KEY, JSON.stringify(["HR"]));
    localStorage.setItem("lettuce.auth.disabledFeatures", JSON.stringify(["FEEDBACKS"]));
    try {
      mockApi(mockFetch, { users: [{ id: 5, name: "Bob", email: "bob@example.com", roles: [] }] });
      renderDetails();

      // The block still renders with its remaining drill-downs…
      expect(await screen.findByText("Audit")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Audit goals of Bob" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Audit 1:1 meetings of Bob" })).toBeInTheDocument();
      // …but the disabled feature's item is gone.
      expect(screen.queryByRole("link", { name: "Audit feedbacks of Bob" })).toBeNull();
    } finally {
      localStorage.removeItem("lettuce.auth.disabledFeatures");
    }
  });

  test("an auditor with every feature disabled gets no Audit block at all (v1.53.0)", async () => {
    localStorage.setItem(ROLE_KEY, JSON.stringify(["HR"]));
    localStorage.setItem(
      "lettuce.auth.disabledFeatures",
      JSON.stringify([
        "FEEDBACKS",
        "ONE_ON_ONES",
        "GOALS",
        "TEAM_KPIS",
        "PERFORMANCE_REVIEWS",
        "DAYS_OFF",
      ]),
    );
    try {
      mockApi(mockFetch, { users: [{ id: 5, name: "Bob", email: "bob@example.com", roles: [] }] });
      renderDetails();

      expect(await screen.findByText("bob@example.com")).toBeInTheDocument();
      expect(screen.queryByText("Audit")).toBeNull();
      expect(screen.queryByRole("link", { name: /^audit /i })).toBeNull();
    } finally {
      localStorage.removeItem("lettuce.auth.disabledFeatures");
    }
  });

  test("regular viewers, ADMIN-only viewers, and self-views get no Audit section", async () => {
    mockApi(mockFetch, { users: [{ id: 5, name: "Bob", email: "bob@example.com", roles: [] }] });
    renderDetails();
    expect(await screen.findByText("bob@example.com")).toBeInTheDocument();
    expect(screen.queryByText("Audit")).toBeNull();

    cleanup();
    // An ADMIN viewing someone else: management role, not an auditor — no Audit section (v1.26.0).
    localStorage.setItem(ROLE_KEY, JSON.stringify(["ADMIN"]));
    mockApi(mockFetch, { users: [{ id: 5, name: "Bob", email: "bob@example.com", roles: [] }] });
    renderDetails();
    expect(await screen.findByText("bob@example.com")).toBeInTheDocument();
    expect(screen.queryByText("Audit")).toBeNull();

    cleanup();
    // An admin viewing THEMSELVES: no audit section on one's own page either.
    localStorage.setItem(ROLE_KEY, JSON.stringify(["ADMIN"]));
    localStorage.setItem(USER_ID_KEY, "5");
    mockApi(mockFetch, { users: [{ id: 5, name: "Bob", email: "bob@example.com", roles: [] }] });
    renderDetails();
    expect(await screen.findByText("bob@example.com")).toBeInTheDocument();
    expect(screen.queryByText("Audit")).toBeNull();
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
      "/teams/3/details",
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

  test("the career profile renders inside the relationship card, off the member rows", async () => {
    // Since v1.32.1 the /teams/members rows carry the profile — no users-list walk needed.
    mockApi(mockFetch, {
      managers: [
        {
          ...BOB_ROW,
          careerPath: { id: 11, value: "Software Engineer" },
          careerSpecialization: null,
          seniorityLevel: { id: 31, value: "Senior" },
        },
      ],
    });
    renderDetails();

    expect(await screen.findByText("Path")).toBeInTheDocument();
    expect(screen.getByText("Software Engineer")).toBeInTheDocument();
    expect(screen.getByText("Senior")).toBeInTheDocument();
    // Exactly the unset field wears the orange badge; the stats column renders beside it.
    expect(screen.getAllByText("Not set")).toHaveLength(1);
    expect(screen.getByText("Last 1:1")).toBeInTheDocument();
    // The old users-list walk is gone on the relationship path.
    expect(mockFetch.mock.calls.some(([u]) => String(u).startsWith("/api/v1/users?"))).toBe(false);
  });

  test("an entirely unset career profile shows three missing badges", async () => {
    mockApi(mockFetch, {
      users: [{ id: 5, name: "Bob", email: "bob@example.com", roles: [] }],
    });
    renderDetails();

    expect(await screen.findByText("Path")).toBeInTheDocument();
    expect(screen.getByText("Specialization")).toBeInTheDocument();
    expect(screen.getByText("Seniority")).toBeInTheDocument();
    expect(screen.getAllByText("Not set")).toHaveLength(3);
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
