import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, renderWithProviders, screen, waitFor, within } from "../test/render";
import TeamKpiValuesEditor from "./TeamKpiValuesEditor";
import { jsonResponse } from "../test/http";
import { todayIsoDate } from "../utils/datetime";
import type { TeamKpiResponse } from "../api/teamkpis";

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

const KPI: TeamKpiResponse = {
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
  description: "",
  type: "NUMBER",
  targetValue: 52,
  currentValue: 12,
  currentValueDate: "2026-07-10",
  status: "ACTIVE",
  summary: null,
  lastModified: Date.now(),
};

const VALUES = [
  { id: 2, date: "2026-07-10", value: 12 },
  { id: 1, date: "2026-07-01", value: 5 },
];

function mockApi(mockFetch: FetchMock, values: unknown[] = VALUES) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/v1/team-kpis/5/values" && !init?.method)
      return Promise.resolve(jsonResponse(200, { items: values }));
    if (init?.method === "POST")
      return Promise.resolve(jsonResponse(201, { id: 9, date: "x", value: 0 }));
    if (init?.method === "PUT" || init?.method === "DELETE")
      return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(jsonResponse(404, {}));
  });
}

describe("TeamKpiValuesEditor", () => {
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

  test("adding a value POSTs the picked date (default today) and value", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<TeamKpiValuesEditor kpi={KPI} />);
    await screen.findByText("12");

    const date = screen.getByLabelText("Date");
    expect(date).toHaveValue(todayIsoDate());
    fireEvent.change(date, { target: { value: "2026-07-15" } });
    await user.type(screen.getByLabelText("Value"), "30");
    await user.click(screen.getByRole("button", { name: "Add value" }));

    await waitFor(() => {
      const post = mockFetch.mock.calls.find(
        ([u, init]) =>
          String(u) === "/api/v1/team-kpis/5/values" && (init as RequestInit)?.method === "POST",
      );
      expect(post).toBeDefined();
      expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({
        date: "2026-07-15",
        value: 30,
      });
    });
  });

  test("a duplicate date is refused client-side without a request", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<TeamKpiValuesEditor kpi={KPI} />);
    await screen.findByText("12");

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-07-10" } });
    await user.type(screen.getByLabelText("Value"), "30");
    await user.click(screen.getByRole("button", { name: "Add value" }));

    expect(
      await screen.findByText(/This date already has a value/),
    ).toBeInTheDocument();
    expect(mockFetch.mock.calls.some(([, init]) => (init as RequestInit)?.method === "POST")).toBe(
      false,
    );
  });

  test("a future date and an empty value are refused client-side", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<TeamKpiValuesEditor kpi={KPI} />);
    await screen.findByText("12");

    // Empty value first.
    await user.click(screen.getByRole("button", { name: "Add value" }));
    expect(await screen.findByText("A value is required")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2999-01-01" } });
    await user.type(screen.getByLabelText("Value"), "30");
    await user.click(screen.getByRole("button", { name: "Add value" }));
    expect(await screen.findByText("The date cannot be in the future")).toBeInTheDocument();
    expect(mockFetch.mock.calls.some(([, init]) => (init as RequestInit)?.method === "POST")).toBe(
      false,
    );
  });

  test("correcting a row PUTs the edited date and value", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<TeamKpiValuesEditor kpi={KPI} />);
    await screen.findByText("12");

    await user.click(screen.getByRole("button", { name: /Edit the value of .*Jul 1, 2026/ }));
    const row = screen.getAllByRole("row")[2]; // header, Jul 10, Jul 1 (being edited)
    fireEvent.change(within(row).getByLabelText("Date"), { target: { value: "2026-07-05" } });
    const valueInput = within(row).getByLabelText("Value");
    await user.clear(valueInput);
    await user.type(valueInput, "6");
    await user.click(within(row).getByRole("button", { name: /Save the value of/ }));

    await waitFor(() => {
      const put = mockFetch.mock.calls.find(
        ([u, init]) =>
          String(u) === "/api/v1/team-kpis/5/values/1" && (init as RequestInit)?.method === "PUT",
      );
      expect(put).toBeDefined();
      expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({
        date: "2026-07-05",
        value: 6,
      });
    });
  });

  test("cancelling an inline edit restores the read-only row without a request", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<TeamKpiValuesEditor kpi={KPI} />);
    await screen.findByText("12");

    await user.click(screen.getByRole("button", { name: /Edit the value of .*Jul 1, 2026/ }));
    await user.click(screen.getByRole("button", { name: /Cancel editing the value of/ }));
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(mockFetch.mock.calls.some(([, init]) => (init as RequestInit)?.method === "PUT")).toBe(
      false,
    );
  });

  test("removing a row confirms and DELETEs it", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderWithProviders(<TeamKpiValuesEditor kpi={KPI} />);
    await screen.findByText("12");

    await user.click(screen.getByRole("button", { name: /Remove the value of .*Jul 10, 2026/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/will be removed/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(
          ([u, init]) =>
            String(u) === "/api/v1/team-kpis/5/values/2" &&
            (init as RequestInit)?.method === "DELETE",
        ),
      ).toBe(true),
    );
  });

  test("a racing server 409 on add maps to the conflict wording", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/v1/team-kpis/5/values" && !init?.method)
        return Promise.resolve(jsonResponse(200, { items: VALUES }));
      if (init?.method === "POST")
        return Promise.resolve(jsonResponse(409, { title: "Conflict" }));
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderWithProviders(<TeamKpiValuesEditor kpi={KPI} />);
    await screen.findByText("12");

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-07-15" } });
    await user.type(screen.getByLabelText("Value"), "30");
    await user.click(screen.getByRole("button", { name: "Add value" }));
    expect(await screen.findByText(/The data point could not be saved/)).toBeInTheDocument();
  });

  test("the empty state shows when the KPI has no data points", async () => {
    mockApi(mockFetch, []);
    renderWithProviders(<TeamKpiValuesEditor kpi={KPI} />);
    expect(await screen.findByText("No data points yet.")).toBeInTheDocument();
  });
});
