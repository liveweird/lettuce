import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { renderWithProviders, screen, waitFor, within } from "../test/render";
import NotificationsButton from "./NotificationsButton";

const TOKEN_KEY = "lettuce.auth.token";

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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
// Rendered EN: "Your feedback request to Dana Dev about Kim Coder has been submitted."
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
const SEEN_TEXT = "Your feedback request to Dana Dev about Kim Coder has been submitted.";

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
    const unseenRow = (await screen.findByText(UNSEEN_TEXT)).closest("[class*='Paper']")!;
    const seenRow = screen.getByText(SEEN_TEXT).closest("[class*='Paper']")!;

    // Unseen row: "New" badge + Mark-as-seen, but no Mark-as-unseen.
    expect(within(unseenRow as HTMLElement).getByText("New")).toBeInTheDocument();
    expect(within(unseenRow as HTMLElement).getByRole("button", { name: /as seen$/i })).toBeInTheDocument();
    expect(within(unseenRow as HTMLElement).queryByRole("button", { name: /as unseen$/i })).toBeNull();
    // Seen row: no "New", no Mark-as-seen, but offers Mark-as-unseen.
    expect(within(seenRow as HTMLElement).queryByText("New")).toBeNull();
    expect(within(seenRow as HTMLElement).queryByRole("button", { name: /as seen$/i })).toBeNull();
    expect(within(seenRow as HTMLElement).getByRole("button", { name: /as unseen$/i })).toBeInTheDocument();
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
      await screen.findByText("Your feedback request to Pat Provider about Sam Subject was rejected.")
    ).closest("[class*='Paper']")!;
    expect(within(row as HTMLElement).queryByRole("button", { name: /go to/i })).toBeNull();
    // Mark as seen is still offered (it is unseen).
    expect(within(row as HTMLElement).getByRole("button", { name: /as seen$/i })).toBeInTheDocument();
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
      await screen.findByText("Your request for feedback about yourself from Pat Provider has been submitted."),
    ).toBeInTheDocument();
  });
});
