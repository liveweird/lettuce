import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithProviders, screen } from "../test/render";
import OneOnOneHistory from "./OneOnOneHistory";
import { jsonResponse } from "../test/http";

type FetchMock = ReturnType<typeof vi.fn>;

function event(id: number, type: string, params: Record<string, string> = {}) {
  return {
    id,
    meetingId: 5,
    userId: 3,
    userName: "Mia Manager",
    timestamp: 1751359200000,
    type,
    params,
  };
}

function renderHistory() {
  return renderWithProviders(
    <OneOnOneHistory meetingId={5} managerName="Mia Manager" subordinateName="Sam Subordinate" />,
  );
}

describe("OneOnOneHistory", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem("lettuce.auth.token", "fake-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders each structured event localized (newest first from the API)", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        // Newest first, the API's order since v2.8.2.
        items: [
          event(9, "DELETED"),
          event(8, "ACTION_ITEM_OWNER_CHANGED", { position: "2", from: "MANAGER", to: "SUBORDINATE" }),
          event(7, "ACTION_ITEM_DUE_DATE_CHANGED", { position: "1", from: "2026-08-01", to: "" }),
          event(6, "ACTION_ITEM_DUE_DATE_CHANGED", { position: "1", from: "", to: "2026-08-01" }),
          event(5, "ACTION_ITEM_RESOLVED", { position: "3" }),
          event(4, "DECISION_REMOVED", { position: "2" }),
          event(3, "POINT_ADDED", { position: "1" }),
          event(2, "DATE_CHANGED", { from: "2026-07-01", to: "2026-07-02" }),
          event(1, "CREATED", { date: "2026-07-01", carriedOver: "2" }),
        ],
      }),
    );
    renderHistory();

    expect(
      await screen.findByText("Meeting created (Jul 1, 2026) — 2 open action items carried over."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Meeting date changed from Jul 1, 2026 to Jul 2, 2026."),
    ).toBeInTheDocument();
    expect(screen.getByText("Point 1 added.")).toBeInTheDocument();
    expect(screen.getByText("Decision 2 removed.")).toBeInTheDocument();
    expect(screen.getByText("Action item 3 resolved.")).toBeInTheDocument();
    expect(
      screen.getByText("Due date of action item 1 set to Aug 1, 2026."),
    ).toBeInTheDocument();
    expect(screen.getByText("Due date of action item 1 removed.")).toBeInTheDocument();
    // Owner enum names resolve to the parties' display names.
    expect(
      screen.getByText("Owner of action item 2 changed from Mia Manager to Sam Subordinate."),
    ).toBeInTheDocument();
    expect(screen.getByText("Meeting deleted.")).toBeInTheDocument();
    // Every entry carries the acting user's name.
    expect(screen.getAllByText(/Mia Manager · /).length).toBeGreaterThan(0);
  });

  test("a creation with no carry-over uses the zero wording", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        items: [event(1, "CREATED", { date: "2026-07-01", carriedOver: "0" })],
      }),
    );
    renderHistory();
    expect(await screen.findByText("Meeting created (Jul 1, 2026).")).toBeInTheDocument();
  });

  test("an unknown event type falls back to the raw name", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, { items: [event(1, "SOMETHING_NEW")] }),
    );
    renderHistory();
    expect(await screen.findByText("SOMETHING_NEW")).toBeInTheDocument();
  });

  test("an empty history renders the empty note", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { items: [] }));
    renderHistory();
    expect(await screen.findByText("No history.")).toBeInTheDocument();
  });
});
