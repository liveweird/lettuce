import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithProviders, screen } from "../test/render";
import FeedbackHistory from "./FeedbackHistory";

const TOKEN_KEY = "lettuce.auth.token";

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("FeedbackHistory", () => {
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

  test("renders the events as a timeline with actor and content", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        items: [
          { id: 1, feedbackId: 5, userId: 10, userName: "Paula", timestamp: 1, content: "Feedback created as a draft." },
          { id: 2, feedbackId: 5, userId: 10, userName: "Paula", timestamp: 2, content: "Status changed from DRAFT to SENT." },
        ],
      }),
    );
    renderWithProviders(<FeedbackHistory feedbackId={5} />);

    expect(await screen.findByText("Feedback created as a draft.")).toBeInTheDocument();
    expect(screen.getByText("Status changed from DRAFT to SENT.")).toBeInTheDocument();
    expect(screen.getAllByText(/Paula/).length).toBeGreaterThan(0);
  });

  test("shows an empty-state note when there are no events", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { items: [] }));
    renderWithProviders(<FeedbackHistory feedbackId={5} />);

    expect(await screen.findByText("No history yet.")).toBeInTheDocument();
  });
});
