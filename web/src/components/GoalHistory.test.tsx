import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithProviders, screen } from "../test/render";
import GoalHistory from "./GoalHistory";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";

type FetchMock = ReturnType<typeof vi.fn>;

let nextId = 1;
function event(type: string, params: Record<string, string> = {}) {
  return {
    id: nextId++,
    goalId: 9,
    userId: 7,
    userName: "Mona Manager",
    timestamp: new Date(2026, 6, 1, 12, 0).getTime(),
    type,
    params,
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
          event("PROGRESS_UPDATED", { from: "0.0", to: "40.5" }),
          event("ACHIEVED_CHANGED", { to: "true" }),
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
    expect(screen.getByText("Progress updated from 0 to 40.5.")).toBeInTheDocument();
    expect(screen.getByText("Marked as achieved.")).toBeInTheDocument();
    expect(screen.getByText("Status changed from Draft to Active.")).toBeInTheDocument();
    expect(screen.getByText("Goal deleted.")).toBeInTheDocument();
    expect(screen.getAllByText(/Mona Manager ·/).length).toBe(9);
  });

  test("the empty-string target sides get their own wording (set / cleared)", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        items: [
          event("TARGET_CHANGED", { from: "", to: "50.0" }),
          event("TARGET_CHANGED", { from: "50.0", to: "" }),
          event("ACHIEVED_CHANGED", { to: "false" }),
        ],
      }),
    );
    renderWithProviders(<GoalHistory goalId={9} />);

    expect(await screen.findByText("Target set to 50.")).toBeInTheDocument();
    expect(screen.getByText("Target removed.")).toBeInTheDocument();
    expect(screen.getByText("Marked as not achieved.")).toBeInTheDocument();
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
