import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import {
  createMemoryRouter,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
  useLocation,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EditOneOnOne from "./EditOneOnOne";
import { jsonResponse } from "../test/http";

type FetchMock = ReturnType<typeof vi.fn>;

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

const MEETING = {
  id: 5,
  managerId: 7,
  isLatest: true,
  minMeetingDate: null as string | null,
  managerName: "Mia Manager",
  subordinateId: 8,
  subordinateName: "Sam Subordinate",
  meetingDate: "2026-07-01",
  lastModified: 1,
  points: [
    { id: 21, content: "First point" },
    { id: 22, content: "Second point" },
  ],
  decisions: [{ id: 31, content: "The decision" }],
  actionItems: [
    {
      id: 41,
      content: "Carried task",
      owner: "SUBORDINATE",
      dueDate: "2026-07-15",
      resolved: false,
      copiedFromId: 40,
      firstAppearedOn: "2026-06-01",
    },
    { id: 42, content: "Fresh task", owner: "MANAGER", dueDate: null, resolved: false, copiedFromId: null },
  ],
};

function renderEdit(route = "/one-on-ones/5/edit") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/one-on-ones/:id/edit" element={<EditOneOnOne />} />
            <Route path="/one-on-ones/:id/view" element={<PathProbe />} />
            <Route path="/one-on-ones" element={<PathProbe />} />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

// The route blocker (`useBlocker`) only exists on a DATA router (the DiscardGuard.test.tsx
// precedent) — the plain-MemoryRouter `renderEdit` above never exercises it, so this harness
// is reserved for the one test that must prove the New-1:1 flow doesn't double-prompt.
function renderEditDataRouter(route = "/one-on-ones/5/edit") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: "/one-on-ones/:id/edit", element: <EditOneOnOne /> },
      { path: "/one-on-ones/:id/view", element: <PathProbe /> },
      { path: "/one-on-ones", element: <PathProbe /> },
      { path: "*", element: <PathProbe /> },
    ],
    { initialEntries: [route] },
  );
  render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );
  return router;
}

describe("EditOneOnOne page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.roles", "[]");
    localStorage.setItem("lettuce.auth.userId", "7"); // the manager
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function stubLoad(meeting = MEETING) {
    mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PUT") return Promise.resolve(new Response(null, { status: 204 }));
      if (init?.method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
      if (url.includes("/events")) return Promise.resolve(jsonResponse(200, { items: [] }));
      if (url.includes("/api/v1/one-on-ones/5")) return Promise.resolve(jsonResponse(200, meeting));
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    });
  }

  test("the date input carries the previous meeting's date as its floor and blocks going below it", async () => {
    stubLoad({ ...MEETING, minMeetingDate: "2026-06-20" });
    renderEdit();

    // The floor is a calendar hint (greyed days) since v3.5.0 — the typed value still lands
    // and the form's own validation explains the rule.
    const dateInput = await screen.findByLabelText("Meeting date");

    // Going below the floor is blocked client-side: inline error, no PUT fired.
    fireEvent.change(dateInput, { target: { value: "2026-06-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Cannot be before the previous meeting (2026-06-20)."),
    ).toBeInTheDocument();
    expect(
      mockFetch.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "PUT"),
    ).toBe(false);
  });

  test("pre-fills the document and shows the carried-over badge", async () => {
    stubLoad();
    renderEdit();

    expect(await screen.findByDisplayValue("First point")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Second point")).toBeInTheDocument();
    expect(screen.getByDisplayValue("The decision")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Carried task")).toBeInTheDocument();
    expect(screen.getByLabelText("Meeting date")).toHaveValue("2026-07-01");
    // Only the carried item is badged.
    expect(screen.getAllByText("Carried over since Jun 1, 2026")).toHaveLength(1);
    // The manager renders as plain "You" (also the owner-select label), the subordinate by name.
    expect(screen.getAllByText("You").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sam Subordinate").length).toBeGreaterThan(0);
    // Every list numbers its rows independently: "1." on the first point, the decision, and
    // the first action item; "2." on the second point and second action item.
    expect(screen.getAllByText("1.")).toHaveLength(3);
    expect(screen.getAllByText("2.")).toHaveLength(2);
  });

  test("a non-manager is redirected to the read-only view", async () => {
    localStorage.setItem("lettuce.auth.userId", "8"); // the subordinate
    stubLoad();
    renderEdit();

    await waitFor(() => expect(screen.getByTestId("probe")).toBeInTheDocument());
    expect(screen.getByTestId("probe")).toHaveTextContent("/one-on-ones/5/view");
  });

  test("an old meeting of the pair (not the latest) is redirected to the read-only view", async () => {
    // The manager loads a non-latest meeting: older 1:1s are immutable records. The redirect
    // preserves the originating tab so the view's Close returns where the user started.
    stubLoad({ ...MEETING, isLatest: false });
    renderEdit("/one-on-ones/5/edit?from=managed");

    await waitFor(() => expect(screen.getByTestId("probe")).toBeInTheDocument());
    expect(screen.getByTestId("probe")).toHaveTextContent("/one-on-ones/5/view?from=managed");
  });

  test("a back override wins over the from-tab mapping after a save", async () => {
    stubLoad();
    const back = "/users/8/one-on-ones?name=Sam";
    renderEdit(`/one-on-ones/5/edit?from=with&back=${encodeURIComponent(back)}`);

    await screen.findByDisplayValue("First point");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByTestId("probe")).toBeInTheDocument());
    expect(screen.getByTestId("probe")).toHaveTextContent(back);
  });

  test("editing lists and saving sends a full-replace body that preserves ids", async () => {
    stubLoad();
    renderEdit();

    // Edit an existing point, remove the second, add a new one.
    const firstPoint = await screen.findByDisplayValue("First point");
    await userEvent.clear(firstPoint);
    await userEvent.type(firstPoint, "First point (edited)");
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Points discussed entry 2" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Add point" }));
    const blankRow = screen.getByLabelText("Points discussed — entry 2", { selector: "textarea" });
    await userEvent.type(blankRow, "Brand new point");

    // Resolve the carried action item.
    const resolved = screen.getAllByRole("checkbox", { name: "Resolved" });
    await userEvent.click(resolved[0]);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByTestId("probe")).toBeInTheDocument());
    expect(screen.getByTestId("probe")).toHaveTextContent("/one-on-ones?tab=managed");

    const [, init] = mockFetch.mock.calls.find(([, i]) => (i as RequestInit)?.method === "PUT")!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.meetingDate).toBe("2026-07-01");
    // The surviving point keeps its id, the new one has none, the removed one is gone.
    expect(body.points).toEqual([
      { id: 21, content: "First point (edited)" },
      { content: "Brand new point" },
    ]);
    expect(body.decisions).toEqual([{ id: 31, content: "The decision" }]);
    expect(body.actionItems).toEqual([
      { id: 41, content: "Carried task", owner: "SUBORDINATE", dueDate: "2026-07-15", resolved: true },
      { id: 42, content: "Fresh task", owner: "MANAGER", dueDate: null, resolved: false },
    ]);
  });

  test("reordering with the arrow buttons swaps rows and keeps ids with their content", async () => {
    stubLoad();
    renderEdit();

    await screen.findByDisplayValue("First point");
    await userEvent.click(
      screen.getByRole("button", { name: "Move Points discussed entry 1 down" }),
    );

    // Ordinals stay fixed to positions while the content moves: the row now holding
    // "Second point" reads "1.".
    const movedRow = screen
      .getByDisplayValue("Second point")
      .closest(".mantine-Paper-root") as HTMLElement;
    expect(within(movedRow).getByText("1.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockFetch.mock.calls.some(([, i]) => (i as RequestInit)?.method === "PUT")).toBe(true),
    );
    const [, init] = mockFetch.mock.calls.find(([, i]) => (i as RequestInit)?.method === "PUT")!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.points).toEqual([
      { id: 22, content: "Second point" },
      { id: 21, content: "First point" },
    ]);
  });

  test("a blank entry blocks saving with a validation message", async () => {
    stubLoad();
    renderEdit();

    const firstPoint = await screen.findByDisplayValue("First point");
    await userEvent.clear(firstPoint);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("The entry must not be empty")).toBeInTheDocument();
    expect(mockFetch.mock.calls.some(([, i]) => (i as RequestInit)?.method === "PUT")).toBe(false);
  });

  test("deleting asks for confirmation, calls DELETE, and returns to the list", async () => {
    stubLoad();
    renderEdit();

    await screen.findByDisplayValue("First point");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const modal = await screen.findByRole("dialog");
    expect(within(modal).getByText(/history is retained/)).toBeInTheDocument();
    await userEvent.click(within(modal).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.getByTestId("probe")).toBeInTheDocument());
    expect(screen.getByTestId("probe")).toHaveTextContent("/one-on-ones?tab=managed");
    expect(
      mockFetch.mock.calls.some(
        ([u, i]) =>
          String(u).includes("/api/v1/one-on-ones/5") && (i as RequestInit)?.method === "DELETE",
      ),
    ).toBe(true);
  });

  test("cancel guards unsaved changes behind the discard confirm", async () => {
    stubLoad();
    renderEdit();

    // The guard asks only once there is work to lose (v3.5.0) — a payload compare, so an
    // edited paragraph counts.
    await userEvent.type(await screen.findByDisplayValue("First point"), " (revised)");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const modal = await screen.findByRole("dialog");
    expect(within(modal).getByText("Discard changes?")).toBeInTheDocument();
    // The discard confirm is a navigation, rendered as a link.
    await userEvent.click(within(modal).getByRole("link", { name: "Discard" }));

    await waitFor(() => expect(screen.getByTestId("probe")).toBeInTheDocument());
    expect(screen.getByTestId("probe")).toHaveTextContent("/one-on-ones?tab=managed");
  });

  describe("New 1:1 button", () => {
    // view=managed rows arrive per (user, team) — the CreateOneOnOne.test.tsx REPORTS shape,
    // pinned to the fixed meeting's subordinate (userId 8).
    const MANAGED_WITH_SUBORDINATE = {
      items: [{ userId: 8, name: "Sam Subordinate", email: "sam@x", teamId: 1, teamName: "AAA" }],
      page: 1,
      pageSize: 100,
      total: 1,
    };
    const NO_MANAGED_REPORTS = { items: [], page: 1, pageSize: 100, total: 0 };

    function stubLoadWithReports(
      options: {
        meeting?: typeof MEETING;
        reports?: typeof MANAGED_WITH_SUBORDINATE;
        putStatus?: number;
      } = {},
    ) {
      const { meeting = MEETING, reports = MANAGED_WITH_SUBORDINATE, putStatus = 204 } = options;
      mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "PUT" && url.includes("/api/v1/one-on-ones/")) {
          return putStatus === 204
            ? Promise.resolve(new Response(null, { status: 204 }))
            : Promise.resolve(
                jsonResponse(putStatus, {
                  type: "about:blank",
                  title: "Error",
                  status: putStatus,
                  detail: "boom",
                }),
              );
        }
        if (init?.method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
        if (url.includes("/events")) return Promise.resolve(jsonResponse(200, { items: [] }));
        if (url.includes("/api/v1/teams/members")) return Promise.resolve(jsonResponse(200, reports));
        if (url.includes("/api/v1/one-on-ones/5")) return Promise.resolve(jsonResponse(200, meeting));
        return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
      });
    }

    const CREATE_URL = "/one-on-ones/new?subordinateId=8&back=%2Fone-on-ones%2F5%2Fedit";

    test("is hidden when the meeting's subordinate is not in the caller's managed pool", async () => {
      stubLoadWithReports({ reports: NO_MANAGED_REPORTS });
      renderEdit();

      await screen.findByDisplayValue("First point");
      expect(screen.queryByRole("button", { name: "New 1:1" })).toBeNull();
    });

    test("a clean form navigates straight to the create URL with subordinateId and back", async () => {
      stubLoadWithReports();
      renderEdit();

      await screen.findByDisplayValue("First point");
      await userEvent.click(await screen.findByRole("button", { name: "New 1:1" }));

      await waitFor(() => expect(screen.getByTestId("probe")).toBeInTheDocument());
      expect(screen.getByTestId("probe")).toHaveTextContent(CREATE_URL);
      expect(
        mockFetch.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "PUT"),
      ).toBe(false);
    });

    test("a dirty form's Save and continue saves the edited body and lands on the create page", async () => {
      stubLoadWithReports();
      renderEdit();

      const firstPoint = await screen.findByDisplayValue("First point");
      await userEvent.type(firstPoint, " (revised)");
      await userEvent.click(screen.getByRole("button", { name: "New 1:1" }));

      const modal = await screen.findByRole("dialog");
      expect(
        within(modal).getByText("Save changes before starting a new 1:1?"),
      ).toBeInTheDocument();
      await userEvent.click(within(modal).getByRole("button", { name: "Save and continue" }));

      await waitFor(() => expect(screen.getByTestId("probe")).toBeInTheDocument());
      expect(screen.getByTestId("probe")).toHaveTextContent(CREATE_URL);

      const [, init] = mockFetch.mock.calls.find(
        ([u, i]) =>
          String(u).includes("/api/v1/one-on-ones/5") && (i as RequestInit)?.method === "PUT",
      )!;
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.points[0]).toEqual({ id: 21, content: "First point (revised)" });
    });

    test("a dirty form's Discard and continue navigates without saving", async () => {
      stubLoadWithReports();
      renderEdit();

      const firstPoint = await screen.findByDisplayValue("First point");
      await userEvent.type(firstPoint, " (revised)");
      await userEvent.click(screen.getByRole("button", { name: "New 1:1" }));

      const modal = await screen.findByRole("dialog");
      await userEvent.click(within(modal).getByRole("button", { name: "Discard and continue" }));

      await waitFor(() => expect(screen.getByTestId("probe")).toBeInTheDocument());
      expect(screen.getByTestId("probe")).toHaveTextContent(CREATE_URL);
      expect(
        mockFetch.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "PUT"),
      ).toBe(false);
    });

    test("a dirty form's Cancel closes the prompt and stays on the page without saving", async () => {
      stubLoadWithReports();
      renderEdit();

      const firstPoint = await screen.findByDisplayValue("First point");
      await userEvent.type(firstPoint, " (revised)");
      await userEvent.click(screen.getByRole("button", { name: "New 1:1" }));

      const modal = await screen.findByRole("dialog");
      await userEvent.click(within(modal).getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(screen.getByDisplayValue("First point (revised)")).toBeInTheDocument();
      expect(
        mockFetch.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "PUT"),
      ).toBe(false);
    });

    test("a save failure closes the prompt and leaves the page's own inline error", async () => {
      stubLoadWithReports({ putStatus: 500 });
      renderEdit();

      const firstPoint = await screen.findByDisplayValue("First point");
      await userEvent.type(firstPoint, " (revised)");
      await userEvent.click(screen.getByRole("button", { name: "New 1:1" }));

      const modal = await screen.findByRole("dialog");
      await userEvent.click(within(modal).getByRole("button", { name: "Save and continue" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(await screen.findByText("Saving failed (HTTP 500).")).toBeInTheDocument();
      // Still on the edit page, edits intact — no navigation happened.
      expect(screen.getByDisplayValue("First point (revised)")).toBeInTheDocument();
    });

    test("choosing Discard and continue never triggers a second discard-guard prompt", async () => {
      stubLoadWithReports();
      const router = renderEditDataRouter();

      const firstPoint = await screen.findByDisplayValue("First point");
      await userEvent.type(firstPoint, " (revised)");
      await userEvent.click(screen.getByRole("button", { name: "New 1:1" }));

      const modal = await screen.findByRole("dialog");
      await userEvent.click(within(modal).getByRole("button", { name: "Discard and continue" }));

      await waitFor(() => expect(router.state.location.pathname).toBe("/one-on-ones/new"));
      // The route blocker (which would otherwise re-open ITS OWN discard confirm on this very
      // same dirty-form departure) never fired a second dialog.
      expect(screen.queryAllByRole("dialog")).toHaveLength(0);
    });
  });
});
