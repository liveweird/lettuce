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
  message: string;
  link: string | null;
  wasSeen: boolean;
};

const UNSEEN: Item = {
  id: 1,
  recipientId: 7,
  timestamp: new Date(2026, 1, 2, 14, 30).getTime(),
  message: "Your feedback was sent",
  link: "/feedback/5/view",
  wasSeen: false,
};
const SEEN: Item = {
  id: 2,
  recipientId: 7,
  timestamp: new Date(2026, 0, 5, 9, 7).getTime(),
  message: "Welcome aboard",
  link: "https://elsewhere.example.com/intro",
  wasSeen: true,
};

// Default: 1 unread for the badge; list returns both rows.
function setupMocks(mockFetch: FetchMock, list: Item[] = [UNSEEN, SEEN], unreadTotal = 1) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    if (method === "POST" && /\/api\/notifications\/\d+\/(seen|unseen)$/.test(u)) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (u.startsWith("/api/notifications") && u.includes("wasSeen=false")) {
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 1, total: unreadTotal }));
    }
    if (u.startsWith("/api/notifications")) {
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

  test("opening lists notifications with distinct seen vs unseen affordances", async () => {
    setupMocks(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<NotificationsButton />);

    await user.click(await screen.findByRole("button", { name: /unread/i }));

    // Both messages render.
    const unseenRow = (await screen.findByText("Your feedback was sent")).closest("[class*='Paper']")!;
    const seenRow = screen.getByText("Welcome aboard").closest("[class*='Paper']")!;

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
    await user.click(await screen.findByRole("button", { name: /as seen$/i }));

    await waitFor(() => {
      expect(
        mockFetch.mock.calls.some(
          ([url, init]) =>
            String(url) === "/api/notifications/1/seen" && (init as RequestInit)?.method === "POST",
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
            String(url) === `/api/notifications/${SEEN.id}/unseen` &&
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
    const linkless = { ...UNSEEN, id: 3, message: "Request was rejected", link: null };
    setupMocks(mockFetch, [linkless]);
    const user = userEvent.setup();
    renderWithProviders(<NotificationsButton />);

    await user.click(await screen.findByRole("button", { name: /unread/i }));
    const row = (await screen.findByText("Request was rejected")).closest("[class*='Paper']")!;
    expect(within(row as HTMLElement).queryByRole("button", { name: /go to/i })).toBeNull();
    // Mark as seen is still offered (it is unseen).
    expect(within(row as HTMLElement).getByRole("button", { name: /as seen$/i })).toBeInTheDocument();
  });

  test("closing the modal does not navigate", async () => {
    setupMocks(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<Harness />);

    await user.click(await screen.findByRole("button", { name: /unread/i }));
    await screen.findByText("Your feedback was sent");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("button", { name: /go to/i })).toBeNull());
    expect(screen.getByTestId("path")).toHaveTextContent("/");
  });
});
