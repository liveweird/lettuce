import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { renderWithProviders, screen, waitFor, within } from "../test/render";
import NotificationsButton from "./NotificationsButton";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";

type FetchMock = ReturnType<typeof vi.fn>;


type Item = {
  id: number;
  recipientId: number;
  timestamp: number;
  type: string;
  params: Record<string, string>;
  link: string | null;
  wasSeen: boolean;
};

// Rendered EN (tests force en): "Feedback from Pat Provider about Sam Subject has been sent."
const UNSEEN: Item = {
  id: 1,
  recipientId: 7,
  timestamp: new Date(2026, 1, 2, 14, 30).getTime(),
  type: "FEEDBACK_SENT_TO_SUBJECT",
  params: { provider: "Pat Provider", subject: "Sam Subject" },
  link: "/feedback/5/view",
  wasSeen: false,
};
// Rendered EN: "You reached out to Dana Dev for feedback regarding Kim Coder."
const SEEN: Item = {
  id: 2,
  recipientId: 7,
  timestamp: new Date(2026, 0, 5, 9, 7).getTime(),
  type: "FEEDBACK_REQUESTED_TO_REQUESTER",
  params: { provider: "Dana Dev", subject: "Kim Coder" },
  link: "https://elsewhere.example.com/intro",
  wasSeen: true,
};

const UNSEEN_TEXT = "Feedback from Pat Provider about Sam Subject has been sent.";
const SEEN_TEXT = "You reached out to Dana Dev for feedback regarding Kim Coder.";

// Default: 1 unread for the badge; list returns both rows.
function setupMocks(mockFetch: FetchMock, list: Item[] = [UNSEEN, SEEN], unreadTotal = 1) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    if (method === "POST" && /\/api\/v1\/notifications\/\d+\/(seen|unseen)$/.test(u)) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (u.startsWith("/api/v1/notifications") && u.includes("wasSeen=false")) {
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 1, total: unreadTotal }));
    }
    if (u.startsWith("/api/v1/notifications")) {
      return Promise.resolve(jsonResponse(200, { items: list, page: 1, pageSize: 50, total: list.length }));
    }
    return Promise.resolve(jsonResponse(404, {}));
  });
}

function LocationProbe() {
  const l = useLocation();
  return <div data-testid="path">{l.pathname + l.search + l.hash}</div>;
}

function Harness() {
  return (
    <>
      <NotificationsButton />
      <LocationProbe />
    </>
  );
}

describe("NotificationsButton", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders the v1.12 notification kinds: manager delivery, password change, 1:1 author", async () => {
    const rows: Item[] = [
      {
        id: 11, recipientId: 7, timestamp: Date.now(), wasSeen: false,
        type: "FEEDBACK_SENT_TO_MANAGER",
        params: { provider: "Pat Provider", subject: "Sam Subject" },
        link: "/feedback/9/view",
      },
      {
        id: 12, recipientId: 7, timestamp: Date.now(), wasSeen: false,
        type: "PASSWORD_CHANGED",
        params: { self: "admin" },
        link: null,
      },
      {
        id: 13, recipientId: 7, timestamp: Date.now(), wasSeen: false,
        type: "ONE_ON_ONE_CREATED_TO_MANAGER",
        params: { subordinate: "Sam Subject", date: "2026-07-12" },
        link: "/one-on-ones/3/view",
      },
    ];
    setupMocks(mockFetch, rows, 3);
    renderWithProviders(<Harness />);
    await userEvent.setup().click(await screen.findByRole("button", { name: /notifications/i }));

    expect(await screen.findByText("Pat Provider sent feedback about Sam Subject, who reports to you.")).toBeInTheDocument();
    expect(screen.getByText("An administrator changed your password.")).toBeInTheDocument();
    expect(screen.getByText("You documented a 1:1 meeting with Sam Subject (2026-07-12).")).toBeInTheDocument();
  });

  test("renders the four goal-transition kinds with the manager's name and the goal title", async () => {
    const rows: Item[] = (
      [
        ["GOAL_ACTIVATED_TO_SUBORDINATE", 21],
        ["GOAL_DEACTIVATED_TO_SUBORDINATE", 22],
        ["GOAL_CLOSED_TO_SUBORDINATE", 23],
        ["GOAL_REOPENED_TO_SUBORDINATE", 24],
      ] as const
    ).map(([type, id]) => ({
      id,
      recipientId: 7,
      timestamp: Date.now(),
      wasSeen: false,
      type,
      params: { manager: "Mona Manager", title: "Raise coverage" },
      link: "/goals/5/view",
    }));
    setupMocks(mockFetch, rows, 4);
    renderWithProviders(<Harness />);
    await userEvent.setup().click(await screen.findByRole("button", { name: /notifications/i }));

    expect(
      await screen.findByText('Mona Manager activated the goal "Raise coverage" for you.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Mona Manager returned the goal "Raise coverage" to draft.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Mona Manager closed the goal "Raise coverage".')).toBeInTheDocument();
    expect(screen.getByText('Mona Manager reopened the goal "Raise coverage".')).toBeInTheDocument();
  });

  test("renders the team-KPI data-point kinds with type-formatted values and localized dates", async () => {
    const base = {
      recipientId: 7,
      timestamp: Date.now(),
      wasSeen: false,
      link: "/team-kpis/5/view",
    };
    const rows: Item[] = [
      {
        ...base,
        id: 31,
        type: "TEAM_KPI_VALUE_RECORDED_TO_MEMBER",
        params: {
          manager: "Mona Manager", title: "Uptime", team: "Team AAA",
          kpiType: "PERCENTAGE", date: "2026-07-27", value: "72.0",
        },
      },
      {
        ...base,
        id: 32,
        type: "TEAM_KPI_VALUE_CORRECTED_TO_MEMBER",
        params: {
          manager: "Mona Manager", title: "Uptime", team: "Team AAA", kpiType: "PERCENTAGE",
          fromDate: "2026-07-27", fromValue: "72.0", toDate: "2026-07-28", toValue: "75.0",
        },
      },
      {
        ...base,
        id: 33,
        type: "TEAM_KPI_VALUE_REMOVED_TO_MEMBER",
        params: {
          manager: "Mona Manager", title: "Uptime", team: "Team AAA",
          kpiType: "NUMBER", date: "2026-07-28", value: "75.0",
        },
      },
    ];
    setupMocks(mockFetch, rows, 3);
    renderWithProviders(<Harness />);
    await userEvent.setup().click(await screen.findByRole("button", { name: /notifications/i }));

    // PERCENTAGE values render with the % suffix, ISO dates per the viewer's locale.
    expect(
      await screen.findByText('Mona Manager recorded 72% for Jul 27, 2026 on the KPI "Uptime" of team Team AAA.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Mona Manager corrected a data point of the KPI "Uptime" of team Team AAA: 72% (Jul 27, 2026) → 75% (Jul 28, 2026).',
      ),
    ).toBeInTheDocument();
    // A NUMBER KPI's value stays a plain number.
    expect(
      screen.getByText('Mona Manager removed the value 75 (Jul 28, 2026) from the KPI "Uptime" of team Team AAA.'),
    ).toBeInTheDocument();
  });

  test("renders the performance-review kinds with locale-formatted period months", async () => {
    const base = { recipientId: 7, timestamp: Date.now(), wasSeen: false };
    const rows: Item[] = [
      {
        ...base,
        id: 41,
        type: "PERFORMANCE_REVIEW_PUBLISHED_TO_SUBORDINATE",
        link: "/performance-reviews/5/view",
        params: { manager: "Mona Manager", startMonth: "2026-01", endMonth: "2026-06" },
      },
      {
        ...base,
        id: 42,
        type: "PERFORMANCE_REVIEW_UNPUBLISHED_TO_SUBORDINATE",
        link: null,
        params: { manager: "Mona Manager", startMonth: "2026-01", endMonth: "2026-06" },
      },
    ];
    setupMocks(mockFetch, rows, 2);
    renderWithProviders(<Harness />);
    await userEvent.setup().click(await screen.findByRole("button", { name: /notifications/i }));

    expect(
      await screen.findByText(
        "Mona Manager published your performance review for the period January 2026 – June 2026.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Mona Manager retracted your performance review for the period January 2026 – June 2026.",
      ),
    ).toBeInTheDocument();
  });

  test("shows the unread count on the bell button", async () => {
    setupMocks(mockFetch, [UNSEEN, SEEN], 3);
    renderWithProviders(<NotificationsButton />);
    expect(await screen.findByRole("button", { name: /3 unread/i })).toBeInTheDocument();
  });

  test("polls the unread count and updates the badge without interaction", async () => {
    // A mutable count so a new notification can "arrive" server-side between polls.
    let unread = 2;
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.startsWith("/api/v1/notifications") && u.includes("wasSeen=false")) {
        return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 1, total: unread }));
      }
      if (u.startsWith("/api/v1/notifications")) {
        return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 50, total: 0 }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });

    vi.useFakeTimers();
    try {
      renderWithProviders(<NotificationsButton />);
      await vi.advanceTimersByTimeAsync(1); // flush the mount fetch
      expect(screen.getByRole("button", { name: /2 unread/i })).toBeInTheDocument();

      // No user interaction — the 30s poll picks up the newly-created notification.
      unread = 5;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(screen.getByRole("button", { name: /5 unread/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  test("'Mark all as seen' posts seen-all and clears the badge", async () => {
    let unread = 2;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "POST" && u.endsWith("/api/v1/notifications/seen-all")) {
        unread = 0; // server marked everything seen
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (u.startsWith("/api/v1/notifications") && u.includes("wasSeen=false")) {
        return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 1, total: unread }));
      }
      if (u.startsWith("/api/v1/notifications")) {
        return Promise.resolve(jsonResponse(200, { items: [UNSEEN], page: 1, pageSize: 50, total: 1 }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });

    const user = userEvent.setup();
    renderWithProviders(<NotificationsButton />);
    await user.click(await screen.findByRole("button", { name: /2 unread/i })); // open the modal
    await user.click(await screen.findByRole("button", { name: /mark all as seen/i }));

    await waitFor(() => {
      expect(
        mockFetch.mock.calls.some(
          ([u, init]) =>
            String(u).endsWith("/api/v1/notifications/seen-all") && (init?.method ?? "GET") === "POST",
        ),
      ).toBe(true);
    });
    // Badge cleared (bell aria-label reflects 0 unread) and the bulk action is gone.
    await screen.findByRole("button", { name: /0 unread/i });
    expect(screen.queryByRole("button", { name: /mark all as seen/i })).not.toBeInTheDocument();
  });

  test("opening lists notifications with distinct seen vs unseen affordances", async () => {
    setupMocks(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<NotificationsButton />);

    await user.click(await screen.findByRole("button", { name: /unread/i }));

    // Both messages render, localized from their structured type + interpolated names.
    const unseenRow = (await screen.findByText(UNSEEN_TEXT)).closest("li")!;
    const seenRow = screen.getByText(SEEN_TEXT).closest("li")!;

    // Unseen row: offers Mark-as-seen, but no Mark-as-unseen.
    expect(within(unseenRow).getByRole("button", { name: /as seen$/i })).toBeInTheDocument();
    expect(within(unseenRow).queryByRole("button", { name: /as unseen$/i })).toBeNull();
    // Seen row: no Mark-as-seen, but offers Mark-as-unseen.
    expect(within(seenRow).queryByRole("button", { name: /as seen$/i })).toBeNull();
    expect(within(seenRow).getByRole("button", { name: /as unseen$/i })).toBeInTheDocument();
  });

  test("Mark as seen posts to the seen endpoint", async () => {
    setupMocks(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<NotificationsButton />);

    await user.click(await screen.findByRole("button", { name: /unread/i }));
    // The per-row action (aria-label "Mark notification 1 as seen"), not the bulk "Mark all as seen".
    await user.click(await screen.findByRole("button", { name: /notification 1 as seen/i }));

    await waitFor(() => {
      expect(
        mockFetch.mock.calls.some(
          ([url, init]) =>
            String(url) === "/api/v1/notifications/1/seen" && (init as RequestInit)?.method === "POST",
        ),
      ).toBe(true);
    });
  });

  test("Mark as unseen posts to the unseen endpoint (seen rows only)", async () => {
    setupMocks(mockFetch, [SEEN]);
    const user = userEvent.setup();
    renderWithProviders(<NotificationsButton />);

    await user.click(await screen.findByRole("button", { name: /unread/i }));
    await user.click(await screen.findByRole("button", { name: /as unseen$/i }));

    await waitFor(() => {
      expect(
        mockFetch.mock.calls.some(
          ([url, init]) =>
            String(url) === `/api/v1/notifications/${SEEN.id}/unseen` &&
            (init as RequestInit)?.method === "POST",
        ),
      ).toBe(true);
    });
  });

  test("Go to navigates to the link's relative path and closes the modal", async () => {
    // Use the cross-origin SEEN link to prove the origin is stripped.
    setupMocks(mockFetch, [SEEN]);
    const user = userEvent.setup();
    renderWithProviders(<Harness />);

    expect(screen.getByTestId("path")).toHaveTextContent("/");
    await user.click(await screen.findByRole("button", { name: /unread/i }));
    await user.click(await screen.findByRole("button", { name: /go to/i }));

    expect(screen.getByTestId("path")).toHaveTextContent("/intro");
    // Modal content is gone once closed.
    await waitFor(() => expect(screen.queryByRole("button", { name: /go to/i })).toBeNull());
  });

  test("Go to on an unseen notification also marks it as seen", async () => {
    setupMocks(mockFetch, [UNSEEN]);
    const user = userEvent.setup();
    renderWithProviders(<Harness />);

    await user.click(await screen.findByRole("button", { name: /unread/i }));
    await user.click(await screen.findByRole("button", { name: /go to/i }));

    expect(screen.getByTestId("path")).toHaveTextContent("/feedback/5/view");
    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(
          ([url, init]) =>
            String(url) === "/api/v1/notifications/1/seen" && (init as RequestInit)?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  test("Go to on an already-seen notification does not re-post seen", async () => {
    setupMocks(mockFetch, [SEEN]);
    const user = userEvent.setup();
    renderWithProviders(<Harness />);

    await user.click(await screen.findByRole("button", { name: /unread/i }));
    await user.click(await screen.findByRole("button", { name: /go to/i }));

    expect(screen.getByTestId("path")).toHaveTextContent("/intro");
    expect(
      mockFetch.mock.calls.some(
        ([, init]) => ((init as RequestInit | undefined)?.method ?? "GET") === "POST",
      ),
    ).toBe(false);
  });

  test("a notification with no link shows no Go to button", async () => {
    const linkless: Item = {
      ...UNSEEN,
      id: 3,
      type: "FEEDBACK_REJECTED_TO_REQUESTER",
      params: { provider: "Pat Provider", subject: "Sam Subject" },
      link: null,
    };
    setupMocks(mockFetch, [linkless]);
    const user = userEvent.setup();
    renderWithProviders(<NotificationsButton />);

    await user.click(await screen.findByRole("button", { name: /unread/i }));
    const row = (
      await screen.findByText("Pat Provider declined to provide feedback about Sam Subject.")
    ).closest("li")!;
    expect(within(row).queryByRole("button", { name: /go to/i })).toBeNull();
    // Mark as seen is still offered (it is unseen).
    expect(within(row).getByRole("button", { name: /as seen$/i })).toBeInTheDocument();
  });

  test("closing the modal does not navigate", async () => {
    setupMocks(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<Harness />);

    await user.click(await screen.findByRole("button", { name: /unread/i }));
    await screen.findByText(UNSEEN_TEXT);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("button", { name: /go to/i })).toBeNull());
    expect(screen.getByTestId("path")).toHaveTextContent("/");
  });

  test("Delete issues DELETE for that notification", async () => {
    setupMocks(mockFetch, [SEEN]);
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "DELETE" && /\/api\/v1\/notifications\/\d+$/.test(u)) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (u.startsWith("/api/v1/notifications") && u.includes("wasSeen=false")) {
        return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 1, total: 0 }));
      }
      if (u.startsWith("/api/v1/notifications")) {
        return Promise.resolve(jsonResponse(200, { items: [SEEN], page: 1, pageSize: 50, total: 1 }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderWithProviders(<NotificationsButton />);

    await user.click(await screen.findByRole("button", { name: /unread/i }));
    await user.click(await screen.findByRole("button", { name: `Delete notification ${SEEN.id}` }));

    await waitFor(() => {
      expect(
        mockFetch.mock.calls.some(
          ([url, init]) =>
            String(url) === `/api/v1/notifications/${SEEN.id}` &&
            (init as RequestInit)?.method === "DELETE",
        ),
      ).toBe(true);
    });
  });

  test("no pager renders when everything fits on one page", async () => {
    setupMocks(mockFetch, [UNSEEN, SEEN]);
    const user = userEvent.setup();
    renderWithProviders(<NotificationsButton />);

    await user.click(await screen.findByRole("button", { name: /unread/i }));
    await screen.findByText(UNSEEN_TEXT);
    expect(screen.queryByRole("button", { name: "2" })).toBeNull();
  });

  test("a pager appears past one page and fetches the requested page", async () => {
    // 120 rows server-side: 3 pages of 50. The mock echoes the requested page.
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.startsWith("/api/v1/notifications") && u.includes("wasSeen=false")) {
        return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 1, total: 0 }));
      }
      if (u.startsWith("/api/v1/notifications")) {
        const page = Number(new URLSearchParams(u.split("?")[1]).get("page") ?? "1");
        const item = { ...SEEN, id: 100 + page, params: { provider: `Page ${page}`, subject: "Kim Coder" } };
        return Promise.resolve(jsonResponse(200, { items: [item], page, pageSize: 50, total: 120 }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderWithProviders(<NotificationsButton />);

    await user.click(await screen.findByRole("button", { name: /unread/i }));
    await screen.findByText(/You reached out to Page 1/);

    await user.click(screen.getByRole("button", { name: "2" }));
    await screen.findByText(/You reached out to Page 2/);
    expect(
      mockFetch.mock.calls.some(([u]) => String(u).includes("page=2")),
    ).toBe(true);

    // Reopening always lands back on the newest page.
    await user.keyboard("{Escape}");
    await user.click(await screen.findByRole("button", { name: /unread/i }));
    await screen.findByText(/You reached out to Page 1/);
  });

  test("renders the 'about yourself' wording when params carry the self context", async () => {
    const selfNote: Item = {
      ...UNSEEN,
      id: 4,
      type: "FEEDBACK_REQUESTED_TO_REQUESTER",
      params: { provider: "Pat Provider", self: "self" },
      link: null,
    };
    setupMocks(mockFetch, [selfNote]);
    const user = userEvent.setup();
    renderWithProviders(<NotificationsButton />);

    await user.click(await screen.findByRole("button", { name: /unread/i }));
    expect(
      await screen.findByText("You asked Pat Provider for feedback on your performance."),
    ).toBeInTheDocument();
  });
});
