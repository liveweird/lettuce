import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, renderWithProviders, screen, waitFor, within } from "../test/render";
import FeedbackTeamTable from "./FeedbackTeamTable";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

type FeedbackItem = {
  id: number;
  requesterId: number | null;
  requesterName: string | null;
  requesterDeleted: boolean;
  subjectId: number;
  subjectName: string;
  subjectDeleted: boolean;
  providerId: number;
  providerName: string;
  providerDeleted: boolean;
  visibility: "PROVIDER_SUBJECT" | "PROVIDER_REQUESTER" | "PROVIDER_REQUESTER_SUBJECT" | "PUBLIC";
  status: "REQUESTED" | "DRAFT" | "SENT" | "WITHDRAWN" | "REJECTED";
  contentPreview: string;
  lastModified: number;
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function feedbacksPage(items: FeedbackItem[], total = items.length): Response {
  return jsonResponse(200, { items, page: 1, pageSize: 20, total });
}

// Current user (set in localStorage below) is the provider on the DRAFT row → can Edit it.
const CURRENT_USER_ID = 11;

const SEED: FeedbackItem[] = [
  {
    id: 1,
    requesterId: 9,
    requesterName: "Carol Requester",
    requesterDeleted: false,
    subjectId: 7,
    subjectName: "Sam Subject",
    subjectDeleted: false,
    providerId: 10,
    providerName: "Alice Provider",
    providerDeleted: false,
    visibility: "PUBLIC",
    status: "SENT",
    contentPreview: "Shipped the migration",
    lastModified: new Date(2026, 0, 5, 9, 7).getTime(),
  },
  {
    id: 2,
    requesterId: null,
    requesterName: null,
    requesterDeleted: false,
    subjectId: 8,
    subjectName: "Tina Subject",
    subjectDeleted: false,
    providerId: CURRENT_USER_ID,
    providerName: "Bob Provider",
    providerDeleted: false,
    visibility: "PROVIDER_SUBJECT",
    status: "DRAFT",
    contentPreview: "Draft in progress",
    lastModified: new Date(2026, 1, 2, 14, 30).getTime(),
  },
];

function setupMocks(mockFetch: FetchMock, response: Response = feedbacksPage(SEED)) {
  mockFetch.mockImplementation((url: string) =>
    Promise.resolve(
      String(url).startsWith("/api/v1/feedbacks") ? response.clone() : jsonResponse(404, {}),
    ),
  );
}

function feedbackUrls(mockFetch: FetchMock): string[] {
  return mockFetch.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith("/api/v1/feedbacks"));
}

describe("FeedbackTeamTable", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "USER");
    localStorage.setItem(USER_ID_KEY, String(CURRENT_USER_ID));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("fetches the team view and renders rows with a formatted Last modified column", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<FeedbackTeamTable />);

    await screen.findByRole("cell", { name: "Sam Subject" });
    expect(feedbackUrls(mockFetch)[0]).toContain("view=team");
    // formatTimestamp output for the SENT row's lastModified.
    expect(screen.getByText("2026-01-05 09:07")).toBeInTheDocument();
    // The caller is the provider of the second row → "You" in its Provider column.
    expect(screen.getByRole("cell", { name: "You" })).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "Bob Provider" })).not.toBeInTheDocument();
    // Other parties (a different user) still render their names.
    expect(screen.getByRole("cell", { name: "Alice Provider" })).toBeInTheDocument();
  });

  test("clicking the Subject header toggles the sort param asc↔desc", async () => {
    setupMocks(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<FeedbackTeamTable />);

    await screen.findByRole("cell", { name: "Sam Subject" });
    // Default sort is subjectName ascending.
    expect(feedbackUrls(mockFetch)[0]).toContain("sort=subjectName");

    await user.click(screen.getByRole("button", { name: /subject/i }));
    await waitFor(() => {
      expect(feedbackUrls(mockFetch).some((u) => u.includes("sort=-subjectName"))).toBe(true);
    });
  });

  test("typing a Provider filter refetches with providerName=", async () => {
    setupMocks(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<FeedbackTeamTable />);

    await screen.findByRole("cell", { name: "Sam Subject" });
    await user.type(screen.getByLabelText(/provider/i), "ali");
    await waitFor(() => {
      expect(feedbackUrls(mockFetch).some((u) => u.includes("providerName=ali"))).toBe(true);
    });
  });

  test("selecting visibility, status, and a Last modified window adds their params", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<FeedbackTeamTable />);

    await screen.findByRole("cell", { name: "Sam Subject" });

    fireEvent.click(screen.getByLabelText("Visibility", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "Public" }));
    await waitFor(() => {
      expect(feedbackUrls(mockFetch).some((u) => u.includes("visibility=PUBLIC"))).toBe(true);
    });

    fireEvent.click(screen.getByLabelText("Status", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "Draft" }));
    await waitFor(() => {
      expect(feedbackUrls(mockFetch).some((u) => u.includes("status=DRAFT"))).toBe(true);
    });

    fireEvent.click(screen.getByLabelText("Last modified", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "Last week" }));
    await waitFor(() => {
      expect(feedbackUrls(mockFetch).some((u) => u.includes("lastModified%5Bgte%5D="))).toBe(true);
    });
  });

  test("shows Edit only for the current user's DRAFT row, View otherwise", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<FeedbackTeamTable />);

    const draftRow = (await screen.findByRole("cell", { name: "Tina Subject" })).closest("tr")!;
    expect(within(draftRow).getByRole("link", { name: /edit/i })).toBeInTheDocument();

    const sentRow = screen.getByRole("cell", { name: "Sam Subject" }).closest("tr")!;
    expect(within(sentRow).getByRole("link", { name: /view/i })).toBeInTheDocument();
    expect(within(sentRow).queryByRole("link", { name: /edit/i })).toBeNull();
  });

  test("typing a Subject filter refetches with subjectName=", async () => {
    setupMocks(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<FeedbackTeamTable />);

    await screen.findByRole("cell", { name: "Sam Subject" });
    await user.type(screen.getByLabelText(/subject/i, { selector: "input" }), "tina");
    await waitFor(() => {
      expect(feedbackUrls(mockFetch).some((u) => u.includes("subjectName=tina"))).toBe(true);
    });
  });

  test("clicking the Requester header toggles the sort param asc↔desc", async () => {
    setupMocks(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<FeedbackTeamTable />);

    await screen.findByRole("cell", { name: "Sam Subject" });
    await user.click(screen.getByRole("button", { name: /requester/i }));
    await waitFor(() =>
      expect(feedbackUrls(mockFetch).some((u) => u.includes("sort=requesterName"))).toBe(true),
    );
    await user.click(screen.getByRole("button", { name: /requester/i }));
    await waitFor(() =>
      expect(feedbackUrls(mockFetch).some((u) => u.includes("sort=-requesterName"))).toBe(true),
    );
  });

  test("switching the sort field resets the direction to ascending", async () => {
    setupMocks(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<FeedbackTeamTable />);

    await screen.findByRole("cell", { name: "Sam Subject" });
    // Default subjectName asc → click Subject to go desc, then click Provider (new field → asc).
    await user.click(screen.getByRole("button", { name: /subject/i }));
    await waitFor(() =>
      expect(feedbackUrls(mockFetch).some((u) => u.includes("sort=-subjectName"))).toBe(true),
    );
    await user.click(screen.getByRole("button", { name: /provider/i }));
    await waitFor(() =>
      expect(feedbackUrls(mockFetch).some((u) => u.includes("sort=providerName"))).toBe(true),
    );
  });

  test("changing the page size refetches with pageSize and resets to page 1", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<FeedbackTeamTable />);

    await screen.findByRole("cell", { name: "Sam Subject" });
    fireEvent.click(screen.getByLabelText("Rows per page", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "40 / page" }));
    await waitFor(() => {
      expect(
        feedbackUrls(mockFetch).some((u) => u.includes("pageSize=40") && u.includes("page=1")),
      ).toBe(true);
    });
  });

  test("clicking page 2 refetches with page=2", async () => {
    setupMocks(mockFetch, feedbacksPage(SEED, 40)); // 40 total / 20 per page → 2 pages
    const user = userEvent.setup();
    renderWithProviders(<FeedbackTeamTable />);

    await screen.findByRole("cell", { name: "Sam Subject" });
    await user.click(screen.getByRole("button", { name: "2" }));
    await waitFor(() =>
      expect(feedbackUrls(mockFetch).some((u) => u.includes("page=2"))).toBe(true),
    );
  });

  test("Edit and View links carry the expected query params", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<FeedbackTeamTable />);

    const draftRow = (await screen.findByRole("cell", { name: "Tina Subject" })).closest("tr")!;
    expect(within(draftRow).getByRole("link", { name: /edit/i })).toHaveAttribute(
      "href",
      "/feedback/2/edit?subjectName=Tina%20Subject&from=team",
    );

    const sentRow = screen.getByRole("cell", { name: "Sam Subject" }).closest("tr")!;
    expect(within(sentRow).getByRole("link", { name: /view/i })).toHaveAttribute(
      "href",
      "/feedback/1/view?as=team&providerName=Alice%20Provider&subjectName=Sam%20Subject&requesterName=Carol%20Requester",
    );
  });

  test("View link omits requesterName when the feedback has no requester", async () => {
    const noRequester: FeedbackItem = {
      ...SEED[0],
      id: 5,
      requesterId: null,
      requesterName: null,
      providerId: 10, // not the current user → View link shown
    };
    setupMocks(mockFetch, feedbacksPage([noRequester]));
    renderWithProviders(<FeedbackTeamTable />);

    const row = (await screen.findByRole("cell", { name: "Sam Subject" })).closest("tr")!;
    const href = within(row).getByRole("link", { name: /view/i }).getAttribute("href")!;
    expect(href).toContain("/feedback/5/view?as=team&providerName=Alice%20Provider");
    expect(href).not.toContain("requesterName=");
  });

  test("shows an empty state when there is no team feedback", async () => {
    setupMocks(mockFetch, feedbacksPage([]));
    renderWithProviders(<FeedbackTeamTable />);
    expect(await screen.findByText(/no feedback/i)).toBeInTheDocument();
  });

  test("shows an error alert when the request fails", async () => {
    setupMocks(mockFetch, jsonResponse(500, { error: "internal", message: "boom" }));
    renderWithProviders(<FeedbackTeamTable />);
    expect(await screen.findByText(/failed to load feedbacks/i)).toBeInTheDocument();
  });
});
