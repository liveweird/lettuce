import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithProviders, screen } from "../test/render";
import TeamKpiHistory from "./TeamKpiHistory";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";

type FetchMock = ReturnType<typeof vi.fn>;

function event(id: number, type: string, params: Record<string, string> = {}) {
  return { id, kpiId: 5, userId: 2, userName: "Mona", timestamp: 1700000000000 + id, type, params };
}

describe("TeamKpiHistory", () => {
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

  test("renders each event kind in the viewer's language, oldest first", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        items: [
          event(1, "CREATED", { type: "NUMBER" }),
          event(2, "TITLE_CHANGED"),
          event(3, "TYPE_CHANGED", { from: "NUMBER", to: "PERCENTAGE" }),
          event(4, "TARGET_CHANGED", { from: "10.0", to: "80.0" }),
          event(5, "VALUE_RECORDED", { date: "2026-07-20", value: "45.0" }),
          event(6, "VALUE_CORRECTED", {
            fromDate: "2026-07-20",
            fromValue: "45.0",
            toDate: "2026-07-21",
            toValue: "47.5",
          }),
          event(7, "VALUE_REMOVED", { date: "2026-07-21", value: "47.5" }),
          event(8, "STATUS_CHANGED", { from: "ACTIVE", to: "ARCHIVED" }),
          event(9, "DELETED"),
        ],
      }),
    );
    renderWithProviders(<TeamKpiHistory kpiId={5} type="NUMBER" />);

    expect(await screen.findByText("Team KPI created (Number).")).toBeInTheDocument();
    expect(screen.getByText("Title changed.")).toBeInTheDocument();
    expect(
      screen.getByText("Type changed from Number to Percentage — the collected data points were removed."),
    ).toBeInTheDocument();
    expect(screen.getByText("Target changed from 10 to 80.")).toBeInTheDocument();
    expect(screen.getByText("Value 45 recorded for Jul 20, 2026.")).toBeInTheDocument();
    expect(
      screen.getByText("Data point corrected: 45 on Jul 20, 2026 → 47.5 on Jul 21, 2026."),
    ).toBeInTheDocument();
    expect(screen.getByText("Removed the value 47.5 of Jul 21, 2026.")).toBeInTheDocument();
    expect(screen.getByText("Status changed from Active to Archived.")).toBeInTheDocument();
    expect(screen.getByText("Team KPI deleted.")).toBeInTheDocument();
  });

  test("a PERCENTAGE KPI's value and target params carry the % suffix", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        items: [
          event(1, "TARGET_CHANGED", { from: "80.0", to: "82.0" }),
          event(2, "VALUE_RECORDED", { date: "2026-07-27", value: "72.0" }),
        ],
      }),
    );
    renderWithProviders(<TeamKpiHistory kpiId={5} type="PERCENTAGE" />);

    expect(await screen.findByText("Value 72% recorded for Jul 27, 2026.")).toBeInTheDocument();
    expect(screen.getByText("Target changed from 80% to 82%.")).toBeInTheDocument();
  });

  test("an empty history renders the empty-state note", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { items: [] }));
    renderWithProviders(<TeamKpiHistory kpiId={5} type="NUMBER" />);
    expect(await screen.findByText("No history.")).toBeInTheDocument();
  });
});
