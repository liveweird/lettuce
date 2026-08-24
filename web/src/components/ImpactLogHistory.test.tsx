import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithProviders, screen } from "../test/render";
import ImpactLogHistory from "./ImpactLogHistory";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";

type FetchMock = ReturnType<typeof vi.fn>;

let nextId = 1;
function event(type: string, params: Record<string, string> = {}) {
  return {
    id: nextId++,
    entryId: 5,
    userId: 7,
    userName: "Olga Owner",
    timestamp: new Date(2026, 6, 1, 12, 0).getTime(),
    type,
    params,
  };
}

describe("ImpactLogHistory", () => {
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

  test("renders every event kind localized, with the actor", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        items: [
          event("CREATED", { periodStart: "2026-07-01", periodEnd: "2026-07-31" }),
          event("UPDATED", {
            changed: "title,periodEnd,contribution",
            periodEndFrom: "2026-07-31",
            periodEndTo: "2026-08-15",
          }),
          event("DELETED"),
        ],
      }),
    );
    renderWithProviders(<ImpactLogHistory entryId={5} />);

    expect(
      await screen.findByText("Entry created for the period Jul 1, 2026 – Jul 31, 2026."),
    ).toBeInTheDocument();
    // The UPDATED event names the changed fields with their labels — the V66 title included
    // (v2.40.1: it used to render as the raw wire token).
    expect(screen.getByText("Entry updated: Title, Period end, My contribution.")).toBeInTheDocument();
    // …and the moved period bound renders its delta as a body line.
    expect(screen.getByText("Period end: Jul 31, 2026 → Aug 15, 2026")).toBeInTheDocument();
    expect(screen.getByText("Entry deleted.")).toBeInTheDocument();
    expect(screen.getAllByText(/Olga Owner ·/)).toHaveLength(3);
  });

  test("an unknown event kind and an unknown field name render raw (forward-compat)", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        items: [event("SOMETHING_NEW"), event("UPDATED", { changed: "newField" })],
      }),
    );
    renderWithProviders(<ImpactLogHistory entryId={5} />);

    expect(await screen.findByText("SOMETHING_NEW")).toBeInTheDocument();
    expect(screen.getByText("Entry updated: newField.")).toBeInTheDocument();
  });

  test("an empty trail shows the empty-state note", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { items: [] }));
    renderWithProviders(<ImpactLogHistory entryId={5} />);
    expect(await screen.findByText("No history yet.")).toBeInTheDocument();
  });
});
