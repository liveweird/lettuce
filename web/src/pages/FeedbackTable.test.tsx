import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, renderWithProviders, screen, waitFor, within } from "../test/render";
import FeedbackTable from "./FeedbackTable";

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
  status: "REQUESTED" | "DRAFT" | "SENT" | "WITHDRAWN";
  contentPreview: string;
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

const SEED_FEEDBACKS: FeedbackItem[] = [
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
    contentPreview: "Great collaboration on the migration project",
  },
  {
    id: 2,
    requesterId: null,
    requesterName: null,
    requesterDeleted: false,
    subjectId: 8,
    subjectName: "Tina Subject",
    subjectDeleted: true,
    providerId: 11,
    providerName: "Bob Provider",
    providerDeleted: true,
    visibility: "PROVIDER_SUBJECT",
    status: "DRAFT",
    contentPreview: "Needs to improve estimates",
  },
];

function setupMocks(mockFetch: FetchMock, response: Response = feedbacksPage(SEED_FEEDBACKS)) {
  mockFetch.mockImplementation((url: string) =>
    Promise.resolve(
      String(url).startsWith("/api/feedbacks") ? response.clone() : jsonResponse(404, {}),
    ),
  );
}

function feedbackUrls(mockFetch: FetchMock): string[] {
  return mockFetch.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith("/api/feedbacks"));
}

describe("FeedbackTable (received view)", () => {
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

  test("renders rows with names, visibility, status and content preview", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<FeedbackTable view="received" />);

    expect(await screen.findByRole("cell", { name: "Carol Requester" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Alice Provider" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Public" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Sent" })).toBeInTheDocument();
    expect(
      screen.getByRole("cell", { name: "Great collaboration on the migration project" }),
    ).toBeInTheDocument();

    const urls = feedbackUrls(mockFetch);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls[0]).toContain("view=received");
  });

  test("renders an em-dash for a missing requester and a (deleted) suffix", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<FeedbackTable view="received" />);

    expect(await screen.findByRole("cell", { name: "—" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Bob Provider (deleted)" })).toBeInTheDocument();
  });

  test("typing in the Requester filter triggers a refetch with requesterName=", async () => {
    setupMocks(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<FeedbackTable view="received" />);

    await screen.findByRole("cell", { name: "Alice Provider" });
    await user.type(screen.getByLabelText(/requester/i), "caro");

    await waitFor(
      () => {
        expect(feedbackUrls(mockFetch).some((url) => url.includes("requesterName=caro"))).toBe(
          true,
        );
      },
      { timeout: 1500 },
    );
  });

  test("selecting Visibility and Status adds the corresponding params", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<FeedbackTable view="received" />);

    await screen.findByRole("cell", { name: "Alice Provider" });

    // happy-dom does not open Mantine comboboxes via userEvent's pointer simulation
    fireEvent.click(screen.getByLabelText("Visibility", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "Public" }));
    await waitFor(() => {
      expect(feedbackUrls(mockFetch).some((url) => url.includes("visibility=PUBLIC"))).toBe(true);
    });

    fireEvent.click(screen.getByLabelText("Status", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "Draft" }));
    await waitFor(() => {
      expect(feedbackUrls(mockFetch).some((url) => url.includes("status=DRAFT"))).toBe(true);
    });
  });

  test("visibility filter offers only the three subject-readable values", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<FeedbackTable view="received" />);

    fireEvent.click(screen.getByLabelText("Visibility", { selector: "input" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Provider + subject",
      "Provider + requester + subject",
      "Public",
    ]);
  });

  test("clicking the Provider header toggles sort between asc and desc", async () => {
    setupMocks(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<FeedbackTable view="received" />);

    await screen.findByRole("cell", { name: "Alice Provider" });
    expect(feedbackUrls(mockFetch)[0]).toContain("sort=providerName");

    await user.click(screen.getByRole("button", { name: /provider/i }));
    await waitFor(() => {
      expect(feedbackUrls(mockFetch).some((url) => url.includes("sort=-providerName"))).toBe(true);
    });

    await user.click(screen.getByRole("button", { name: /requester/i }));
    await waitFor(() => {
      expect(feedbackUrls(mockFetch).some((url) => url.includes("sort=requesterName"))).toBe(true);
    });
  });

  test("pagination and page size controls update the query", async () => {
    setupMocks(mockFetch, feedbacksPage(SEED_FEEDBACKS, 45));
    const user = userEvent.setup();
    renderWithProviders(<FeedbackTable view="received" />);

    await screen.findByRole("cell", { name: "Alice Provider" });
    expect(screen.getByText("45 total")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "2" }));
    await waitFor(() => {
      expect(feedbackUrls(mockFetch).some((url) => url.includes("page=2"))).toBe(true);
    });

    fireEvent.click(screen.getByLabelText("Rows per page", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "40 / page" }));
    await waitFor(() => {
      const url = feedbackUrls(mockFetch).find((u) => u.includes("pageSize=40"));
      expect(url).toBeDefined();
      expect(url).toContain("page=1");
    });
  });

  test("shows empty state when there is no feedback", async () => {
    setupMocks(mockFetch, feedbacksPage([]));
    renderWithProviders(<FeedbackTable view="received" />);

    expect(await screen.findByText(/no feedback/i)).toBeInTheDocument();
  });

  test("shows an error alert when the request fails", async () => {
    setupMocks(mockFetch, jsonResponse(500, { error: "internal", message: "boom" }));
    renderWithProviders(<FeedbackTable view="received" />);

    expect(await screen.findByText(/failed to load feedbacks/i)).toBeInTheDocument();
  });

  test("within() sanity: rows are ordered as returned by the API", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<FeedbackTable view="received" />);

    await screen.findByRole("cell", { name: "Alice Provider" });
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Alice Provider")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Bob Provider (deleted)")).toBeInTheDocument();
  });

  test("the received view has no Edit links", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<FeedbackTable view="received" />);

    await screen.findByRole("cell", { name: "Alice Provider" });
    expect(screen.queryByRole("link", { name: /edit feedback for/i })).not.toBeInTheDocument();
  });
});

describe("FeedbackTable (provided view)", () => {
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

  test("shows the Subject column, fetches view=provided and defaults to sort=subjectName", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<FeedbackTable view="provided" />);

    expect(await screen.findByRole("cell", { name: "Sam Subject" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Tina Subject (deleted)" })).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "Alice Provider" })).not.toBeInTheDocument();

    const urls = feedbackUrls(mockFetch);
    expect(urls[0]).toContain("view=provided");
    expect(urls[0]).toContain("sort=subjectName");
  });

  test("typing in the Subject filter triggers a refetch with subjectName=", async () => {
    setupMocks(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<FeedbackTable view="provided" />);

    await screen.findByRole("cell", { name: "Sam Subject" });
    await user.type(screen.getByLabelText("Subject"), "tina");

    await waitFor(
      () => {
        expect(feedbackUrls(mockFetch).some((url) => url.includes("subjectName=tina"))).toBe(true);
      },
      { timeout: 1500 },
    );
  });

  test("visibility filter offers all four values", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<FeedbackTable view="provided" />);

    fireEvent.click(screen.getByLabelText("Visibility", { selector: "input" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Provider + subject",
      "Provider + requester",
      "Provider + requester + subject",
      "Public",
    ]);
  });

  test("clicking the Subject header toggles to sort=-subjectName", async () => {
    setupMocks(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<FeedbackTable view="provided" />);

    await screen.findByRole("cell", { name: "Sam Subject" });
    await user.click(screen.getByRole("button", { name: /subject/i }));

    await waitFor(() => {
      expect(feedbackUrls(mockFetch).some((url) => url.includes("sort=-subjectName"))).toBe(true);
    });
  });

  test("shows an Edit link only on DRAFT rows pointing at the edit route", async () => {
    setupMocks(mockFetch);
    renderWithProviders(<FeedbackTable view="provided" />);

    // Row 2 (Tina) is DRAFT; row 1 (Sam) is SENT.
    const editLinks = await screen.findAllByRole("link", { name: /edit feedback for/i });
    expect(editLinks).toHaveLength(1);
    expect(editLinks[0]).toHaveAttribute("href", "/feedback/2/edit?subjectName=Tina%20Subject");
    expect(
      screen.queryByRole("link", { name: /edit feedback for sam subject/i }),
    ).not.toBeInTheDocument();
  });
});
