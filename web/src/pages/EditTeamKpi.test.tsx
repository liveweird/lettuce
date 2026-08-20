import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, renderWithProviders, screen, waitFor } from "../test/render";
import { Route, Routes, useLocation } from "react-router-dom";
import EditTeamKpi from "./EditTeamKpi";
import { jsonResponse } from "../test/http";

vi.mock("../components/MarkdownEditor", async () =>
  (await import("../test/mockMarkdownEditor")).mockMarkdownEditorModule(),
);

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
  creatorId: 7,
  creatorName: "Me",
  creatorDeleted: false,
  canManage: true,
  canRecordValues: true,
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

  test("Save & activate PUTs, posts the activate action, and lands on backTo — not the view redirect", async () => {
    // Stateful mock: once activated, the refetched document is ACTIVE — the invalidation-driven
    // refetch must not let the non-DRAFT redirect win over saveDefinition's navigate(backTo).
    let activated = false;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/v1/team-kpis/5" && !init?.method)
        return Promise.resolve(
          jsonResponse(200, activated ? { ...DRAFT_KPI, status: "ACTIVE" } : DRAFT_KPI),
        );
      if (u === "/api/v1/team-kpis/5/events") return Promise.resolve(jsonResponse(200, { items: [] }));
      if (u.endsWith("/activate")) {
        activated = true;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (init?.method === "PUT") return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderEdit();
    await screen.findByLabelText(/title/i);

    await user.click(screen.getByRole("button", { name: "Save & activate" }));
    await waitFor(() =>
      expect(mockFetch.mock.calls.some(([u]) => String(u).endsWith("/activate"))).toBe(true),
    );
    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent("/team-kpis?tab=managed"),
    );
    expect(screen.queryByTestId("view-screen")).not.toBeInTheDocument();
  });

  test("the DRAFT editor's Delete confirms and removes the draft", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderEdit();
    await screen.findByLabelText(/title/i);

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

  test("a non-manager, an ACTIVE, and an ARCHIVED KPI all redirect to the view screen", async () => {
    // The route edits DRAFT definitions only (v1.29.0) — data points live on the view screen.
    mockApi(mockFetch, { ...DRAFT_KPI, managerId: 99, canManage: false, canRecordValues: false });
    renderEdit();
    expect(await screen.findByTestId("view-screen")).toBeInTheDocument();

    vi.clearAllMocks();
    mockApi(mockFetch, { ...DRAFT_KPI, status: "ACTIVE" });
    renderEdit();
    expect(await screen.findByTestId("view-screen")).toBeInTheDocument();

    vi.clearAllMocks();
    mockApi(mockFetch, { ...DRAFT_KPI, status: "ARCHIVED" });
    renderEdit();
    expect(await screen.findByTestId("view-screen")).toBeInTheDocument();
  });
});
