import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, renderWithProviders, screen, waitFor } from "../test/render";
import { Route, Routes, useLocation } from "react-router-dom";
import CreateTeamKpi from "./CreateTeamKpi";
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

const MANAGED_TEAMS = {
  items: [
    { id: 10, name: "Team AAA", managerId: 7, managerName: "Me", managerDeleted: false },
    { id: 11, name: "Team BBB", managerId: 7, managerName: "Me", managerDeleted: false },
  ],
  page: 1,
  pageSize: 100,
  total: 2,
};

const CREATED = {
  id: 42,
  teamId: 10,
  teamName: "Team AAA",
  teamDeleted: false,
  managerId: 7,
  managerName: "Me",
  createdAt: Date.now(),
  title: "Deploy weekly",
  description: "",
  type: "NUMBER",
  targetValue: 52,
  currentValue: 0,
  status: "DRAFT",
  summary: null,
  lastModified: Date.now(),
};

function mockApi(mockFetch: FetchMock) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("/api/v1/teams?")) return Promise.resolve(jsonResponse(200, MANAGED_TEAMS));
    if (u === "/api/v1/team-kpis" && init?.method === "POST")
      return Promise.resolve(jsonResponse(201, CREATED));
    if (u === "/api/v1/team-kpis/42/activate" && init?.method === "POST")
      return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(jsonResponse(404, {}));
  });
}

function renderCreate(route = "/team-kpis/new") {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/team-kpis/new" element={<CreateTeamKpi />} />
        <Route path="*" element={<div />} />
      </Routes>
      <PathProbe />
    </>,
    { route },
  );
}

describe("CreateTeamKpi", () => {
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

  test("picks a managed team, creates as DRAFT, and No on the prompt returns to the origin", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderCreate();

    // The picker offers the caller's managed teams.
    fireEvent.click(await screen.findByLabelText("Team", { selector: "input" }));
    await user.click(await screen.findByRole("option", { name: "Team AAA" }));

    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "Deploy weekly" } });
    fireEvent.change(screen.getByLabelText(/target/i), { target: { value: "52" } });
    await user.click(screen.getByRole("button", { name: "Create" }));

    // The KPI exists — the activate prompt appears; "No" keeps the draft and navigates back.
    expect(await screen.findByText("Do you want to activate the KPI immediately?")).toBeInTheDocument();
    const create = mockFetch.mock.calls.find(
      ([u, init]) => String(u) === "/api/v1/team-kpis" && (init as RequestInit)?.method === "POST",
    );
    expect(JSON.parse((create![1] as RequestInit).body as string)).toMatchObject({
      teamId: 10,
      title: "Deploy weekly",
      type: "NUMBER",
      targetValue: 52,
    });

    await user.click(screen.getByRole("button", { name: "No" }));
    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent("/team-kpis?tab=managed"),
    );
    expect(mockFetch.mock.calls.some(([u]) => String(u).endsWith("/activate"))).toBe(false);
  });

  test("Yes on the prompt activates the fresh draft", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderCreate();

    fireEvent.click(await screen.findByLabelText("Team", { selector: "input" }));
    await user.click(await screen.findByRole("option", { name: "Team AAA" }));
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "Deploy weekly" } });
    fireEvent.change(screen.getByLabelText(/target/i), { target: { value: "52" } });
    await user.click(screen.getByRole("button", { name: "Create" }));

    await user.click(await screen.findByRole("button", { name: "Yes" }));
    await waitFor(() =>
      expect(mockFetch.mock.calls.some(([u]) => String(u).endsWith("/activate"))).toBe(true),
    );
  });

  test("a prefilled teamId skips the picker and Create submits against it", async () => {
    mockApi(mockFetch);
    renderCreate("/team-kpis/new?teamId=10&teamName=Team%20AAA&back=%2Fteams%2F10%2Fkpis");

    // No Select — the team renders as a read-only fact.
    expect(await screen.findByText("Team AAA")).toBeInTheDocument();
    expect(screen.queryByLabelText("Team", { selector: "input" })).not.toBeInTheDocument();
    // No picker query was needed.
    expect(mockFetch.mock.calls.some(([u]) => String(u).startsWith("/api/v1/teams?"))).toBe(false);
  });

  test("a missing target is refused client-side", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderCreate("/team-kpis/new?teamId=10");

    fireEvent.change(await screen.findByLabelText(/title/i), { target: { value: "No target" } });
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("A target value is required")).toBeInTheDocument();
    expect(
      mockFetch.mock.calls.some(
        ([u, init]) => String(u) === "/api/v1/team-kpis" && (init as RequestInit)?.method === "POST",
      ),
    ).toBe(false);
  });
});
