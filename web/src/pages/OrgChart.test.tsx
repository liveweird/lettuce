import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { fireEvent, renderWithProviders, screen, waitFor, within } from "../test/render";
import OrgChart from "./OrgChart";
import { jsonResponse } from "../test/http";
import { todayIsoDate } from "../utils/datetime";

// happy-dom can't measure the canvas, so React Flow itself is mocked — but the mock renders
// the page's REAL custom node components (via nodeTypes), so PersonNode/TeamNode logic
// (aria labels, self/deleted gating, navigation) is exercised. The mockMarkdownEditor idiom.
vi.mock("@xyflow/react", () => ({
  /* eslint-disable @typescript-eslint/no-explicit-any -- typing the mocked ReactFlow props against the real library's generic node/edge types isn't worth it in a test-only stub */
  ReactFlow: ({ nodes, edges, nodeTypes }: any) => (
    <div data-testid="canvas" data-edge-count={edges.length}>
      {nodes.map((n: any) => {
        const NodeComponent = nodeTypes[n.type];
        return <NodeComponent key={n.id} data={n.data} />;
      })}
    </div>
  ),
  /* eslint-enable @typescript-eslint/no-explicit-any */
  Handle: () => null,
  Controls: () => null,
  Background: () => null,
  BackgroundVariant: { Dots: "dots" },
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  MarkerType: { ArrowClosed: "arrowclosed" },
}));

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

const TEAMS = [
  { id: 1, name: "AAA", managerId: 10, managerName: "Manager AAA", managerDeleted: false, memberIds: [1] },
  { id: 3, name: "CCC", managerId: 12, managerName: "Manager CCC", managerDeleted: false, memberIds: [10] },
  { id: 9, name: "Orphan", managerId: 42, managerName: "Zed", managerDeleted: true, memberIds: [] },
];
const USERS = [
  { id: 1, name: "AAA One", email: "a1@x", roles: [] },
  { id: 10, name: "Manager AAA", email: "ma@x", roles: [] },
  { id: 12, name: "Manager CCC", email: "mc@x", roles: [] },
  { id: 50, name: "Floater", email: "fl@x", roles: [] }, // in no team — the unattached section
];

function mockApi(mockFetch: FetchMock, teams = TEAMS, users = USERS) {
  mockFetch.mockImplementation((url: string) => {
    const u = String(url);
    if (u.startsWith("/api/v1/teams?"))
      return Promise.resolve(jsonResponse(200, { items: teams, page: 1, pageSize: 100, total: teams.length }));
    if (u.startsWith("/api/v1/users?"))
      return Promise.resolve(jsonResponse(200, { items: users, page: 1, pageSize: 100, total: users.length }));
    return Promise.resolve(jsonResponse(404, {}));
  });
}

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname + location.search}</div>;
}

function renderOrg() {
  return renderWithProviders(
    <Routes>
      <Route path="/org" element={<OrgChart />} />
      <Route path="/users/:userId/details" element={<PathProbe />} />
      <Route path="/teams/:id/details" element={<PathProbe />} />
    </Routes>,
    { route: "/org" },
  );
}

describe("OrgChart page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(USER_ID_KEY, "12"); // the caller is Manager CCC
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders people and teams as nodes with the edges wired", async () => {
    mockApi(mockFetch);
    renderOrg();

    // The heading renders immediately; nodes after the data lands.
    expect(screen.getByRole("heading", { name: "Org chart" })).toBeInTheDocument();
    expect(await screen.findByText("AAA One")).toBeInTheDocument();
    expect(screen.getByText("Manager AAA")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Members of AAA" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Members of CCC" })).toBeInTheDocument();
    // 3 manages edges + 2 member edges.
    expect(screen.getByTestId("canvas")).toHaveAttribute("data-edge-count", "5");
    // The teamless user renders too, under the section label, as an ordinary clickable node.
    expect(screen.getByText("Not in any team")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "User details for Floater" })).toBeInTheDocument();
    // memberIds ride the teams list: no per-team GET /api/v1/teams/{id} (the v4.14.0 fix).
    const urls = mockFetch.mock.calls.map(([url]) => String(url));
    expect(urls.filter((u) => /^\/api\/v1\/teams\/\d+/.test(u))).toEqual([]);
  });

  test("a deactivated person's node is marked: the Inactive pill and a dashed, tinted node; active nodes are plain", async () => {
    mockApi(
      mockFetch,
      TEAMS,
      USERS.map((u) => (u.id === 1 ? { ...u, deactivated: true } : { ...u, deactivated: false })),
    );
    renderOrg();

    const node = (await screen.findByRole("button", { name: "User details for AAA One" })).closest(
      ".mantine-Paper-root",
    ) as HTMLElement;
    expect(within(node).getByText("Inactive")).toBeInTheDocument();
    expect(node.style.borderStyle).toBe("dashed");
    // The aria-label stays the stable "User details for …" and only that one person is marked.
    expect(screen.getAllByText("Inactive")).toHaveLength(1);
    const active = screen.getByRole("button", { name: "User details for Manager AAA" }).closest(
      ".mantine-Paper-root",
    ) as HTMLElement;
    expect(within(active).queryByText("Inactive")).not.toBeInTheDocument();
    expect(active.style.borderStyle).not.toBe("dashed");
  });

  test("person nodes open the details view with the org origin — except self and deleted", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderOrg();

    // A deleted manager renders plain and dimmed, not clickable.
    expect(await screen.findByText(/Zed \(deleted\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "User details for Zed" })).not.toBeInTheDocument();
    // One's own node is plain too.
    expect(screen.queryByRole("button", { name: "User details for Manager CCC" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "User details for Manager AAA" }));
    expect(screen.getByTestId("probe")).toHaveTextContent("/users/10/details?name=Manager+AAA&from=org");
  });

  test("collapsing a team folds its members and their subtrees away; expanding restores them", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderOrg();

    expect(await screen.findByText("AAA One")).toBeInTheDocument();
    // A team with no members gets no toggle at all.
    expect(screen.queryByRole("button", { name: /team Orphan/ })).not.toBeInTheDocument();

    // Collapsing CCC hides its member (Manager AAA) AND cascades through the team they
    // manage: AAA and AAA One fold away too. Only the two manages edges into CCC/Orphan stay.
    await user.click(screen.getByRole("button", { name: "Collapse team CCC" }));
    expect(screen.queryByText("Manager AAA")).not.toBeInTheDocument();
    expect(screen.queryByText("AAA One")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Members of AAA" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Members of CCC" })).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument(); // the hidden-members count
    expect(screen.getByTestId("canvas")).toHaveAttribute("data-edge-count", "2");

    await user.click(screen.getByRole("button", { name: "Expand team CCC" }));
    expect(screen.getByText("Manager AAA")).toBeInTheDocument();
    expect(screen.getByText("AAA One")).toBeInTheDocument();
    expect(screen.getByTestId("canvas")).toHaveAttribute("data-edge-count", "5");
  });

  test("team nodes open the roster", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderOrg();

    await user.click(await screen.findByRole("button", { name: "Members of CCC" }));
    // The org origin rides along so the roster's back link returns to the chart.
    expect(screen.getByTestId("probe")).toHaveTextContent("/teams/3/details?from=org");
  });

  test("with no teams the people still render in the unattached section", async () => {
    mockApi(mockFetch, []);
    renderOrg();

    expect(await screen.findByText("Not in any team")).toBeInTheDocument();
    expect(screen.getByText("Floater")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "User details for AAA One" })).toBeInTheDocument();
    expect(screen.queryByText(/No teams yet/)).not.toBeInTheDocument();
  });

  test("shows the empty state only when there are no teams AND no users", async () => {
    mockApi(mockFetch, [], []);
    renderOrg();

    expect(await screen.findByText(/No teams yet/)).toBeInTheDocument();
  });

  test("shows an alert when the composition fails", async () => {
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse(500, { error: "boom" })));
    renderOrg();

    expect(await screen.findByText("Failed to load the organization")).toBeInTheDocument();
  });
  describe("as of a date (v4.17.0)", () => {
    const PAST = "2025-03-01";
    // The as-of list: team 1 live then, team 7 since deleted (dimmed); Gone is a person deleted
    // since — absent from today's directory, so the roster rows carry the name.
    const AS_OF_TEAMS = [
      {
        id: 1, name: "AAA", managerId: 10, managerName: "Manager AAA", managerDeleted: false, deleted: false,
        memberIds: [1, 60],
        members: [
          { id: 1, name: "AAA One", deleted: false, deactivated: false },
          { id: 60, name: "Gone", deleted: true, deactivated: false },
        ],
      },
      {
        id: 7, name: "Defunct", managerId: 12, managerName: "Manager CCC", managerDeleted: false, deleted: true,
        memberIds: [], members: [],
      },
    ];

    function mockAsOfApi() {
      mockFetch.mockImplementation((url: string) => {
        const u = String(url);
        if (u.startsWith("/api/v1/teams?")) {
          const asOf = new URL(u, "http://x").searchParams.get("asOf");
          const items = asOf ? AS_OF_TEAMS : TEAMS;
          return Promise.resolve(jsonResponse(200, { items, page: 1, pageSize: 100, total: items.length }));
        }
        if (u.startsWith("/api/v1/users?"))
          return Promise.resolve(jsonResponse(200, { items: USERS, page: 1, pageSize: 100, total: USERS.length }));
        return Promise.resolve(jsonResponse(404, {}));
      });
    }

    function renderAt(route: string) {
      return renderWithProviders(
        <Routes>
          <Route
            path="/org"
            element={
              <>
                <OrgChart />
                <PathProbe />
              </>
            }
          />
        </Routes>,
        { route },
      );
    }

    const teamsUrls = () =>
      mockFetch.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith("/api/v1/teams?"));

    test("no param is today: the unchanged fast path (no asOf), no badge, the field shows today", async () => {
      mockAsOfApi();
      renderAt("/org");

      expect(await screen.findByText("AAA One")).toBeInTheDocument();
      expect(teamsUrls().every((u) => !u.includes("asOf"))).toBe(true);
      expect(screen.getByLabelText("As of")).toHaveValue(todayIsoDate());
      expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();
    });

    test("?asOf= fetches the as-of list, names people from its rosters, dims a deleted team and shows the badge", async () => {
      mockAsOfApi();
      renderAt(`/org?asOf=${PAST}`);

      // A person deleted since is named by the as-of roster and marked deleted.
      expect(await screen.findByText(/Gone \(deleted\)/)).toBeInTheDocument();
      expect(teamsUrls().some((u) => u.includes(`asOf=${PAST}`))).toBe(true);
      // The deleted team is still on the chart: dashed, dimmed, tagged, with no button to open
      // a live page and no expand/collapse toggle (nothing to fold; its members stay visible).
      const defunct = screen.getByText(/Defunct \(deleted\)/);
      expect(screen.queryByRole("button", { name: "Members of Defunct" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /team Defunct/ })).not.toBeInTheDocument();
      const node = defunct.closest(".mantine-Paper-root") as HTMLElement;
      expect(node.style.borderStyle).toBe("dashed");
      // A live team is not tagged.
      expect(screen.queryByText(/AAA \(deleted\)/)).not.toBeInTheDocument();
      // Off today: the badge, the reset and the hint about the "Not in any team" source.
      expect(screen.getByText(/^As of /)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
      expect(screen.getByText(/taken from today's directory/)).toBeInTheDocument();
      // Today's users still supply the unattached section.
      expect(screen.getByText("Floater")).toBeInTheDocument();
    });

    test("picking a date writes ?asOf= and refetches; Today resets the param and the fetch", async () => {
      mockAsOfApi();
      const user = userEvent.setup();
      renderAt("/org");
      await screen.findByText("AAA One");

      const field = screen.getByLabelText("As of");
      fireEvent.change(field, { target: { value: PAST } });
      fireEvent.blur(field);
      await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent(`/org?asOf=${PAST}`));
      expect(await screen.findByText(/Gone \(deleted\)/)).toBeInTheDocument();
      expect(teamsUrls().some((u) => u.includes(`asOf=${PAST}`))).toBe(true);

      await user.click(screen.getByRole("button", { name: "Today" }));
      await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent(/^\/org$/));
      expect(await screen.findByText("Manager AAA")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();
      expect(screen.queryByText(/Gone/)).not.toBeInTheDocument();
    });

    test("clicking a deleted team's node navigates nowhere", async () => {
      mockAsOfApi();
      const user = userEvent.setup();
      renderAt(`/org?asOf=${PAST}`);

      await user.click(await screen.findByText(/Defunct \(deleted\)/));
      expect(screen.getByTestId("probe")).toHaveTextContent(`/org?asOf=${PAST}`);
    });

    test("a live team opened from an off-today chart returns to that chart (back=/org?asOf=…)", async () => {
      mockAsOfApi();
      const user = userEvent.setup();
      renderWithProviders(
        <Routes>
          <Route path="/org" element={<OrgChart />} />
          <Route path="/teams/:id/details" element={<PathProbe />} />
        </Routes>,
        { route: `/org?asOf=${PAST}` },
      );

      await user.click(await screen.findByRole("button", { name: "Members of AAA" }));
      expect(screen.getByTestId("probe")).toHaveTextContent(
        `/teams/1/details?from=org&back=${encodeURIComponent(`/org?asOf=${PAST}`)}`,
      );
    });

    test("a future date is an ordinary as-of date (badge, as-of fetch)", async () => {
      mockAsOfApi();
      const future = "2099-01-01";
      renderAt(`/org?asOf=${future}`);

      expect(await screen.findByText(/Gone \(deleted\)/)).toBeInTheDocument();
      expect(teamsUrls().some((u) => u.includes(`asOf=${future}`))).toBe(true);
      expect(screen.getByText(/^As of /)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
    });

    test("a malformed ?asOf= falls back to today", async () => {
      mockAsOfApi();
      renderAt("/org?asOf=not-a-date");

      expect(await screen.findByText("AAA One")).toBeInTheDocument();
      expect(teamsUrls().every((u) => !u.includes("asOf"))).toBe(true);
      expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();
    });
  });
});
