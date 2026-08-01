import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, renderWithProviders, screen, waitFor } from "../test/render";
import { Route, Routes, useLocation } from "react-router-dom";
import EditTeamKpi from "./EditTeamKpi";
import { jsonResponse } from "../test/http";
import { todayIsoDate } from "../utils/datetime";

vi.mock("../components/MarkdownEditor", async () =>
  (await import("../test/mockMarkdownEditor")).mockMarkdownEditorModule(),
);

// happy-dom can't measure recharts — stub the chart (the ViewTeamKpi.test precedent).
vi.mock("@mantine/charts", () => ({
  LineChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="line-chart" data-points={data.length} />
  ),
}));

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

const DRAFT_KPI = {
  id: 5,
  teamId: 10,
  teamName: "Team AAA",
  teamDeleted: false,
  managerId: 7,
  managerName: "Me",
  createdAt: Date.now(),
  title: "Deploy weekly",
  description: "One release per week",
  type: "NUMBER",
  targetValue: 52,
  currentValue: 0,
  currentValueDate: null,
  status: "DRAFT",
  summary: null,
  lastModified: Date.now(),
};

function mockApi(mockFetch: FetchMock, kpi: unknown = DRAFT_KPI) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/v1/team-kpis/5" && !init?.method) return Promise.resolve(jsonResponse(200, kpi));
    if (u === "/api/v1/team-kpis/5/events") return Promise.resolve(jsonResponse(200, { items: [] }));
    if (init?.method === "PUT" || init?.method === "POST" || init?.method === "DELETE")
      return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(jsonResponse(404, {}));
  });
}

function renderEdit(route = "/team-kpis/5/edit") {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/team-kpis/:id/edit" element={<EditTeamKpi />} />
        <Route path="/team-kpis/:id/view" element={<div data-testid="view-screen" />} />
        <Route path="*" element={<div />} />
      </Routes>
      <PathProbe />
    </>,
    { route },
  );
}

describe("EditTeamKpi", () => {
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

  test("a DRAFT renders the definition form; Save draft PUTs the definition", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderEdit();

    expect(await screen.findByRole("heading", { name: "Edit team KPI" })).toBeInTheDocument();
    const title = await screen.findByLabelText(/title/i);
    expect(title).toHaveValue("Deploy weekly");
    fireEvent.change(title, { target: { value: "Deploy twice a week" } });
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      const put = mockFetch.mock.calls.find(
        ([u, init]) => String(u) === "/api/v1/team-kpis/5" && (init as RequestInit)?.method === "PUT",
      );
      expect(put).toBeDefined();
      expect(JSON.parse((put![1] as RequestInit).body as string)).toMatchObject({
        title: "Deploy twice a week",
        type: "NUMBER",
        targetValue: 52,
      });
    });
  });

  test("Save & activate PUTs then posts the activate action", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderEdit();
    await screen.findByRole("heading", { name: "Edit team KPI" });

    await user.click(screen.getByRole("button", { name: "Save & activate" }));
    await waitFor(() =>
      expect(mockFetch.mock.calls.some(([u]) => String(u).endsWith("/activate"))).toBe(true),
    );
  });

  test("the DRAFT editor's Delete confirms and removes the draft", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderEdit();
    await screen.findByRole("heading", { name: "Edit team KPI" });

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText(/history is retained/)).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Delete" }).at(-1)!);
    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(
          ([u, init]) =>
            String(u) === "/api/v1/team-kpis/5" && (init as RequestInit)?.method === "DELETE",
        ),
      ).toBe(true),
    );
  });

  test("an ACTIVE KPI renders the progress form; Save PUTs the value with its date (default today)", async () => {
    mockApi(mockFetch, { ...DRAFT_KPI, status: "ACTIVE", currentValue: 12 });
    const user = userEvent.setup();
    renderEdit();

    expect(await screen.findByRole("heading", { name: "Update progress" })).toBeInTheDocument();
    const current = await screen.findByLabelText(/current/i);
    fireEvent.change(current, { target: { value: "20" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const put = mockFetch.mock.calls.find(([u]) => String(u).endsWith("/progress"));
      expect(put).toBeDefined();
      expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({
        currentValue: 20,
        date: todayIsoDate(),
      });
    });
  });

  test("a future value date blocks the save; a backdated one is sent as picked", async () => {
    mockApi(mockFetch, { ...DRAFT_KPI, status: "ACTIVE", currentValue: 12 });
    const user = userEvent.setup();
    renderEdit();
    await screen.findByRole("heading", { name: "Update progress" });

    // Future first — validation blocks, so the form stays mounted for the second half.
    const date = await screen.findByLabelText(/value date/i);
    fireEvent.change(date, { target: { value: "2999-01-01" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The value date cannot be in the future")).toBeInTheDocument();
    expect(mockFetch.mock.calls.some(([u]) => String(u).endsWith("/progress"))).toBe(false);

    fireEvent.change(date, { target: { value: "2026-01-15" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const put = mockFetch.mock.calls.find(([u]) => String(u).endsWith("/progress"));
      expect(put).toBeDefined();
      expect(JSON.parse((put![1] as RequestInit).body as string)).toMatchObject({ date: "2026-01-15" });
    });
  });

  test("the ACTIVE editor has a Graph tab rendering the value-over-time chart", async () => {
    mockApi(mockFetch, { ...DRAFT_KPI, status: "ACTIVE", currentValue: 12 });
    const user = userEvent.setup();
    renderEdit();
    await screen.findByRole("heading", { name: "Update progress" });

    await user.click(await screen.findByRole("tab", { name: "Graph" }));
    // Only the synthesized origin point exists (the mocked events list is empty), so the chart
    // shows its empty state — the tab itself is what this pins.
    expect(await screen.findByText(/No progress has been recorded yet/)).toBeInTheDocument();
  });

  test("a non-manager and a CLOSED KPI both redirect to the view screen", async () => {
    mockApi(mockFetch, { ...DRAFT_KPI, managerId: 99 });
    renderEdit();
    expect(await screen.findByTestId("view-screen")).toBeInTheDocument();

    vi.clearAllMocks();
    mockApi(mockFetch, { ...DRAFT_KPI, status: "CLOSED" });
    renderEdit();
    expect(await screen.findByTestId("view-screen")).toBeInTheDocument();
  });
});
