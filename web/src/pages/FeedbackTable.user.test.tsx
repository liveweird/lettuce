import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "../test/render";
import FeedbackTable from "./FeedbackTable";
import { jsonResponse } from "../test/http";

// The HR auditor view (view=user&userId=X): both party columns, every status,
// always a View action — even on a row the auditor themselves provided.

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

const AUDITOR_ID = 99;

const SEED = [
  {
    id: 1,
    requesterId: null,
    requesterName: null,
    requesterDeleted: false,
    subjectId: 7,
    subjectName: "Sam Subject",
    subjectDeleted: false,
    providerId: 10,
    providerName: "Alice Provider",
    providerDeleted: false,
    visibility: "PROVIDER_SUBJECT",
    status: "DRAFT",
    contentPreview: "Unredacted draft preview",
    lastModified: new Date(2026, 5, 1, 9, 0).getTime(),
  },
  {
    id: 2,
    requesterId: null,
    requesterName: null,
    requesterDeleted: false,
    subjectId: 7,
    subjectName: "Sam Subject",
    subjectDeleted: false,
    providerId: AUDITOR_ID,
    providerName: "Harry Auditor",
    providerDeleted: false,
    visibility: "PUBLIC",
    status: "DRAFT",
    contentPreview: "The auditor's own draft",
    lastModified: new Date(2026, 5, 2, 9, 0).getTime(),
  },
];

describe("FeedbackTable user (auditor) view", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn((url: string) =>
      Promise.resolve(
        String(url).startsWith("/api/v1/feedbacks")
          ? jsonResponse(200, { items: SEED, page: 1, pageSize: 20, total: SEED.length })
          : jsonResponse(404, {}),
      ),
    );
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, JSON.stringify(["HR"]));
    localStorage.setItem(USER_ID_KEY, String(AUDITOR_ID));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("queries view=user with the target id and shows both party columns", async () => {
    renderWithProviders(<FeedbackTable view="user" userId={7} />);

    expect(await screen.findByText("Alice Provider")).toBeInTheDocument();
    expect(screen.getAllByText("Sam Subject").length).toBeGreaterThan(0);
    // The unredacted DRAFT preview is visible to the auditor.
    expect(screen.getByText("Unredacted draft preview")).toBeInTheDocument();
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([u]) => String(u));
      expect(urls.some((u) => u.includes("view=user") && u.includes("userId=7"))).toBe(true);
    });
  });

  test("every row gets a View action - no Edit even on the auditor's own draft", async () => {
    renderWithProviders(<FeedbackTable view="user" userId={7} />);

    await screen.findByText("Alice Provider");
    expect(screen.getAllByRole("link", { name: /view/i })).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /edit/i })).toBeNull();
  });
});
