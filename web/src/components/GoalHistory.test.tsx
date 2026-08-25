import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithProviders, screen } from "../test/render";
import GoalHistory from "./GoalHistory";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";

type FetchMock = ReturnType<typeof vi.fn>;

let nextId = 1;
function event(type: string, params: Record<string, string> = {}, comment?: string) {
  return {
    id: nextId++,
    goalId: 9,
    userId: 7,
    userName: "Mona Manager",
    timestamp: new Date(2026, 6, 1, 12, 0).getTime(),
    type,
    params,
    comment: comment ?? null,
  };
}

describe("GoalHistory", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    nextId = 1;
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders every event kind localized, with the actor and timestamp", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        items: [
          event("CREATED", { type: "NUMBER" }),
          event("TITLE_CHANGED"),
          event("DESCRIPTION_CHANGED"),
          event("TYPE_CHANGED", { from: "NUMBER", to: "PERCENTAGE" }),
          event("TARGET_CHANGED", { from: "10.0", to: "80.0" }),
          event("TARGET_DIRECTION_CHANGED", { from: "AT_LEAST", to: "AT_MOST" }),
          event("PROGRESS_UPDATED", { from: "0.0", to: "40.5" }),
          event("PROGRESS_COMMENTED"),
          // Historical only since v2.9.0 (the old BINARY type's flip) — still renders.
          event("ACHIEVED_CHANGED", { to: "true" }),
          event("MILESTONE_ADDED", { position: "2" }),
          event("MILESTONE_EDITED", { position: "2" }),
          event("MILESTONE_REMOVED", { position: "1" }),
          event("MILESTONE_COMPLETED", { position: "3" }),
          event("MILESTONE_REOPENED", { position: "3" }),
          event("STATUS_CHANGED", { from: "DRAFT", to: "ACTIVE" }),
          event("DELETED"),
        ],
      }),
    );
    renderWithProviders(<GoalHistory goalId={9} />);

    expect(await screen.findByText("Goal created (Number).")).toBeInTheDocument();
    expect(screen.getByText("Title changed.")).toBeInTheDocument();
    expect(screen.getByText("Description changed.")).toBeInTheDocument();
    expect(screen.getByText("Type changed from Number to Percentage.")).toBeInTheDocument();
    expect(screen.getByText("Target changed from 10 to 80.")).toBeInTheDocument();
    expect(
      screen.getByText("Target direction changed from At least to At most."),
    ).toBeInTheDocument();
    expect(screen.getByText("Progress updated from 0 to 40.5.")).toBeInTheDocument();
    expect(screen.getByText("Progress note added.")).toBeInTheDocument();
    expect(screen.getByText("Marked as achieved.")).toBeInTheDocument();
    expect(screen.getByText("Milestone 2 added.")).toBeInTheDocument();
    expect(screen.getByText("Milestone 2 edited.")).toBeInTheDocument();
    expect(screen.getByText("Milestone 1 removed.")).toBeInTheDocument();
    expect(screen.getByText("Milestone 3 marked as done.")).toBeInTheDocument();
    expect(screen.getByText("Milestone 3 marked as not done.")).toBeInTheDocument();
    expect(screen.getByText("Status changed from Draft to Active.")).toBeInTheDocument();
    expect(screen.getByText("Goal deleted.")).toBeInTheDocument();
    expect(screen.getAllByText(/Mona Manager ·/)).toHaveLength(16);
  });

  test("a progress update's comment renders under its timeline entry", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        items: [
          event("PROGRESS_UPDATED", { from: "0.0", to: "40.5" }, "Two modules landed.\nOne left."),
          event("PROGRESS_COMMENTED", {}, "No movement — blocked."),
          event("STATUS_CHANGED", { from: "DRAFT", to: "ACTIVE" }),
        ],
      }),
    );
    renderWithProviders(<GoalHistory goalId={9} />);

    // Pre-wrap plain text (not markdown), one comment per commented event.
    expect(await screen.findByText(/Two modules landed\./)).toBeInTheDocument();
    expect(screen.getByText("No movement — blocked.")).toBeInTheDocument();
  });

  test("the empty-string target sides get their own wording (set / cleared)", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        items: [
          event("TARGET_CHANGED", { from: "", to: "50.0" }),
          event("TARGET_CHANGED", { from: "50.0", to: "" }),
          event("TARGET_DIRECTION_CHANGED", { from: "", to: "AT_LEAST" }),
          event("TARGET_DIRECTION_CHANGED", { from: "AT_LEAST", to: "" }),
          event("ACHIEVED_CHANGED", { to: "false" }),
        ],
      }),
    );
    renderWithProviders(<GoalHistory goalId={9} />);

    expect(await screen.findByText("Target set to 50.")).toBeInTheDocument();
    expect(screen.getByText("Target removed.")).toBeInTheDocument();
    expect(screen.getByText("Target direction set to At least.")).toBeInTheDocument();
    expect(screen.getByText("Target direction removed.")).toBeInTheDocument();
    expect(screen.getByText("Marked as not achieved.")).toBeInTheDocument();
  });

  test("a first progress update (empty from) reads as Progress set", async () => {
    // v2.8.1: fresh goals have no value — the first update's `from` is "" (the target idiom).
    mockFetch.mockResolvedValue(
      jsonResponse(200, { items: [event("PROGRESS_UPDATED", { from: "", to: "40.5" })] }),
    );
    renderWithProviders(<GoalHistory goalId={9} />);

    expect(await screen.findByText("Progress set to 40.5.")).toBeInTheDocument();
  });

  test("an unknown event kind falls back to its raw type name", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, { items: [event("SOMETHING_NEW", { x: "1" })] }),
    );
    renderWithProviders(<GoalHistory goalId={9} />);

    expect(await screen.findByText("SOMETHING_NEW")).toBeInTheDocument();
  });

  test("no events renders the empty-state note", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { items: [] }));
    renderWithProviders(<GoalHistory goalId={9} />);

    expect(await screen.findByText("No history.")).toBeInTheDocument();
  });
});
