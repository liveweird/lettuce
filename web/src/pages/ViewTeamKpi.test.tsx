import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { renderWithProviders, screen, waitFor, within } from "../test/render";
import ViewTeamKpi from "./ViewTeamKpi";
import { jsonResponse } from "../test/http";

// happy-dom can't measure the recharts canvas — stub the chart primitives and assert the
// props our chart component passes (the OrgChart @xyflow/react mock precedent).
vi.mock("@mantine/charts", () => ({
  /* eslint-disable @typescript-eslint/no-explicit-any */
  LineChart: ({ data, referenceLines }: any) => (
    <div
      data-testid="line-chart"
      data-points={data.length}
      data-reference-y={referenceLines?.[0]?.y}
    />
  ),
  /* eslint-enable @typescript-eslint/no-explicit-any */
}));

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

const KPI = {
  id: 5,
  teamId: 10,
  teamName: "Team AAA",
  teamDeleted: false,
  managerId: 7,
  managerName: "Me",
  createdAt: new Date(2026, 4, 1).getTime(),
  title: "Deploy weekly",
  description: "One production release per week",
  type: "NUMBER",
  targetValue: 52,
  currentValue: 12,
  currentValueDate: null,
  status: "ACTIVE",
  summary: null,
  lastModified: new Date(2026, 6, 1).getTime(),
};

const EVENTS = [
  {
    id: 1,
    kpiId: 5,
    userId: 7,
    userName: "Me",
    timestamp: KPI.createdAt,
    type: "CREATED",
    params: { type: "NUMBER" },
  },
  {
    id: 2,
    kpiId: 5,
    userId: 7,
    userName: "Me",
    timestamp: KPI.createdAt + 1000,
    type: "PROGRESS_UPDATED",
    params: { from: "0.0", to: "12.0" },
  },
];

function mockApi(mockFetch: FetchMock, kpi: unknown = KPI, events: unknown[] = EVENTS) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/v1/team-kpis/5" && !init?.method) return Promise.resolve(jsonResponse(200, kpi));
    if (u === "/api/v1/team-kpis/5/events") return Promise.resolve(jsonResponse(200, { items: events }));
    if (init?.method === "POST") return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(jsonResponse(404, {}));
  });
}

function renderView(route = "/team-kpis/5/view") {
  return renderWithProviders(
    <Routes>
      <Route path="/team-kpis/:id/view" element={<ViewTeamKpi />} />
      <Route path="*" element={<div data-testid="elsewhere" />} />
    </Routes>,
    { route },
  );
}

describe("ViewTeamKpi", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders the document with team, manager-as-You, values, and the manager's ACTIVE actions", async () => {
    mockApi(mockFetch);
    renderView();

    expect(await screen.findByText("Deploy weekly")).toBeInTheDocument();
    expect(screen.getByText("Team AAA")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("One production release per week")).toBeInTheDocument();
    // ACTIVE offers Return-to-draft + Close (and Edit).
    expect(screen.getByRole("button", { name: "Return to draft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close KPI" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit" })).toBeInTheDocument();
  });

  test("the Graph tab lazy-loads the chart with the derived series and the target line", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderView();
    await screen.findByText("Deploy weekly");

    await user.click(screen.getByRole("tab", { name: "Graph" }));
    const chart = await screen.findByTestId("line-chart");
    // Origin point + one PROGRESS_UPDATED; the reference line sits at the target.
    expect(chart).toHaveAttribute("data-points", "2");
    expect(chart).toHaveAttribute("data-reference-y", "52");
  });

  test("a single value backdated before creation still renders the chart, not the empty note", async () => {
    const preCreation = [
      {
        id: 2,
        kpiId: 5,
        userId: 7,
        userName: "Me",
        timestamp: KPI.createdAt + 1000,
        type: "PROGRESS_UPDATED",
        params: { to: "30.0", date: "2026-01-15" }, // before createdAt (May 2026) → origin suppressed
      },
    ];
    mockApi(mockFetch, KPI, preCreation);
    const user = userEvent.setup();
    renderView();
    await screen.findByText("Deploy weekly");

    await user.click(screen.getByRole("tab", { name: "Graph" }));
    const chart = await screen.findByTestId("line-chart");
    expect(chart).toHaveAttribute("data-points", "1");
    expect(screen.queryByText(/No progress has been recorded yet/)).not.toBeInTheDocument();
  });

  test("the Current value carries an as-of note once a dated value is recorded", async () => {
    mockApi(mockFetch, { ...KPI, currentValueDate: "2026-07-20" });
    renderView();

    expect(await screen.findByText("Deploy weekly")).toBeInTheDocument();
    expect(screen.getByText(/\(as of .*2026.*\)/)).toBeInTheDocument();
  });

  test("a non-manager viewer gets no action buttons", async () => {
    mockApi(mockFetch, { ...KPI, managerId: 99, managerName: "Mona" });
    renderView();

    expect(await screen.findByText("Deploy weekly")).toBeInTheDocument();
    expect(screen.getByText("Mona")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close KPI" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
  });

  test("closing collects the mandatory summary and posts the close action", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderView();
    await screen.findByText("Deploy weekly");

    await user.click(screen.getByRole("button", { name: "Close KPI" }));
    const dialog = await screen.findByRole("dialog");
    // Blank summary refused client-side.
    await user.click(within(dialog).getByRole("button", { name: "Close KPI" }));
    expect(await screen.findByText("A summary is required to close a KPI")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/Summary/), "Great year");
    await user.click(within(dialog).getByRole("button", { name: "Close KPI" }));
    await waitFor(() => {
      const close = mockFetch.mock.calls.find(([u]) => String(u).endsWith("/close"));
      expect(close).toBeDefined();
      expect(JSON.parse((close![1] as RequestInit).body as string)).toEqual({ summary: "Great year" });
    });
  });

  test("the CLOSED status offers Reopen and shows the summary", async () => {
    mockApi(mockFetch, { ...KPI, status: "CLOSED", summary: "Wrapped up" });
    renderView();

    expect(await screen.findByText("Wrapped up")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
  });

  test("a 403 renders the permission error", async () => {
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse(403, { title: "Forbidden" })));
    renderView();
    expect(await screen.findByText("You may not view this team KPI.")).toBeInTheDocument();
  });
});
