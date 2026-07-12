import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, renderWithProviders, screen, waitFor, within } from "../test/render";
import ViewOneOnOne from "./ViewOneOnOne";
import { Route, Routes } from "react-router-dom";
import { jsonResponse } from "../test/http";

type FetchMock = ReturnType<typeof vi.fn>;

const MEETING = {
  id: 5,
  managerId: 3,
  managerName: "Mia Manager",
  subordinateId: 8,
  subordinateName: "Sam Subordinate",
  meetingDate: "2026-07-01",
  lastModified: 1,
  points: [
    { id: 21, content: "Roadmap review" },
    { id: 22, content: "Vacation plans" },
  ],
  decisions: [{ id: 31, content: "Ship v2 in August" }],
  actionItems: [
    {
      id: 41,
      content: "Prepare the demo",
      owner: "SUBORDINATE",
      dueDate: "2026-07-15",
      resolved: false,
      copiedFromId: 40,
      firstAppearedOn: "2026-06-01",
    },
    { id: 42, content: "Book the room", owner: "MANAGER", dueDate: null, resolved: true, copiedFromId: null },
  ],
};

const HISTORY = {
  items: [
    {
      actionItemId: 40,
      meetingId: 4,
      meetingDate: "2026-06-24",
      content: "Prepare the demo",
      owner: "SUBORDINATE",
      dueDate: null,
      resolved: false,
    },
    {
      actionItemId: 41,
      meetingId: 5,
      meetingDate: "2026-07-01",
      content: "Prepare the demo",
      owner: "SUBORDINATE",
      dueDate: "2026-07-15",
      resolved: false,
    },
  ],
};

function renderView(route = "/one-on-ones/5/view") {
  return renderWithProviders(
    <Routes>
      <Route path="/one-on-ones/:id/view" element={<ViewOneOnOne />} />
    </Routes>,
    { route },
  );
}

describe("ViewOneOnOne page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.role", "USER");
    localStorage.setItem("lettuce.auth.userId", "8"); // the subordinate
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/action-items/")) return Promise.resolve(jsonResponse(200, HISTORY));
      if (url.includes("/events")) return Promise.resolve(jsonResponse(200, { items: [] }));
      if (url.includes("/api/v1/one-on-ones/5")) return Promise.resolve(jsonResponse(200, MEETING));
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders the document read-only with parties, lists, and badges", async () => {
    renderView();

    // The manager appears as the party chip and again as an action item's owner.
    expect(await screen.findAllByText("Mia Manager")).not.toHaveLength(0);
    // The caller is the subordinate → plain "You" (party field + owner cell).
    expect(screen.getAllByText("You").length).toBeGreaterThan(0);
    expect(screen.queryByText("Sam Subordinate")).toBeNull();

    expect(screen.getByText("Roadmap review")).toBeInTheDocument();
    expect(screen.getByText("Vacation plans")).toBeInTheDocument();
    expect(screen.getByText("Ship v2 in August")).toBeInTheDocument();
    expect(screen.getByText("Prepare the demo")).toBeInTheDocument();
    // The carried item names its origin meeting's date; the fresh one carries no badge.
    expect(screen.getByText("Carried over since Jun 1, 2026")).toBeInTheDocument();
    expect(screen.queryByText(/^Carried over$/)).toBeNull();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Resolved")).toBeInTheDocument();
    // No editing affordances anywhere.
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add point" })).toBeNull();
  });

  test("a back override wins over the from-tab mapping for the Close link", async () => {
    const back = "/users/3/one-on-ones?name=Mia";
    renderView(`/one-on-ones/5/view?from=with&back=${encodeURIComponent(back)}`);

    expect(await screen.findAllByText("Mia Manager")).not.toHaveLength(0);
    expect(screen.getByRole("link", { name: "Close" })).toHaveAttribute("href", back);
  });

  test("Close returns to the originating tab: managed stays managed, unknown falls back to own", async () => {
    // The managed tab links old (read-only) rows here with from=managed — closing must not
    // strand the manager on the "I'm a subordinate" tab.
    renderView("/one-on-ones/5/view?from=managed");
    expect(await screen.findAllByText("Mia Manager")).not.toHaveLength(0);
    expect(screen.getByRole("link", { name: "Close" })).toHaveAttribute(
      "href",
      "/one-on-ones?tab=managed",
    );

    cleanup();
    renderView("/one-on-ones/5/view?from=bogus");
    expect(await screen.findAllByText("Mia Manager")).not.toHaveLength(0);
    expect(screen.getByRole("link", { name: "Close" })).toHaveAttribute(
      "href",
      "/one-on-ones?tab=own",
    );
  });

  test("a carried item whose chain no longer survives falls back to the plain badge", async () => {
    const meeting = {
      ...MEETING,
      actionItems: [
        {
          id: 41,
          content: "Prepare the demo",
          owner: "SUBORDINATE",
          dueDate: null,
          resolved: false,
          copiedFromId: 40,
          firstAppearedOn: null,
        },
      ],
    };
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/events")) return Promise.resolve(jsonResponse(200, { items: [] }));
      if (url.includes("/api/v1/one-on-ones/5")) return Promise.resolve(jsonResponse(200, meeting));
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    });
    renderView();

    expect(await screen.findByText("Carried over")).toBeInTheDocument();
    expect(screen.queryByText(/Carried over since/)).toBeNull();
  });

  test("the action-item history modal lists every meeting the item appeared in", async () => {
    renderView();

    await screen.findByText("Prepare the demo");
    await userEvent.click(
      screen.getByRole("button", { name: "Show the history of action item 1" }),
    );
    const modal = await screen.findByRole("dialog");
    expect(within(modal).getByText("Action item history")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(modal).getAllByText("Prepare the demo")).toHaveLength(2),
    );
    expect(
      mockFetch.mock.calls.some(([u]) =>
        String(u).includes("/api/v1/one-on-ones/action-items/41/history"),
      ),
    ).toBe(true);
  });

  test("a 403 renders the permission message", async () => {
    mockFetch.mockResolvedValue(jsonResponse(403, { title: "no" }));
    renderView();
    expect(
      await screen.findByText("You are not allowed to view this 1:1 meeting."),
    ).toBeInTheDocument();
  });

  test("a 404 renders the not-found message", async () => {
    mockFetch.mockResolvedValue(jsonResponse(404, { title: "no" }));
    renderView();
    expect(await screen.findByText("This 1:1 meeting was not found.")).toBeInTheDocument();
  });
});
