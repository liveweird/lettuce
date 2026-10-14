import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { fireEvent, renderWithProviders, screen, waitFor, within } from "../test/render";
import TeamHistory from "./TeamHistory";
import { jsonResponse } from "../test/http";
import { addIsoDays, todayIsoDate } from "../utils/datetime";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

const TODAY = todayIsoDate();
const LONG_AGO = addIsoDays(TODAY, -400);
const YESTERDAY = addIsoDays(TODAY, -1);
const NEXT_MONTH = addIsoDays(TODAY, 30);

const TEAM = { id: 5, name: "Platform", managerId: 11, managerName: "Bob Boss", managerDeleted: false, memberIds: [21] };

// Server order: chronological, a null start first.
const MANAGERS = [
  { id: 1, managerId: 10, managerName: "Mona Manager", managerDeleted: false, startDate: null, endDate: addIsoDays(LONG_AGO, -1), current: false },
  { id: 2, managerId: 11, managerName: "Bob Boss", managerDeleted: false, startDate: LONG_AGO, endDate: null, current: true },
];
const MEMBERSHIPS = [
  { id: 31, userId: 22, userName: "Past Pat", userDeleted: false, deactivated: false, startDate: null, endDate: YESTERDAY, current: false },
  { id: 32, userId: 21, userName: "Current Cy", userDeleted: false, deactivated: false, startDate: LONG_AGO, endDate: null, current: true },
  { id: 33, userId: 23, userName: "Soon Sam", userDeleted: false, deactivated: false, startDate: NEXT_MONTH, endDate: null, current: false },
];
const USERS = [
  { id: 10, name: "Mona Manager", email: "m@x", roles: [], deactivated: false, teams: [] },
  { id: 11, name: "Bob Boss", email: "b@x", roles: [], deactivated: false, teams: [] },
  { id: 24, name: "Newcomer Nia", email: "n@x", roles: [], deactivated: false, teams: [] },
  { id: 25, name: "Dormant Dee", email: "d@x", roles: [], deactivated: true, teams: [] },
];

const problem = (status: number, detail: string) =>
  new Response(JSON.stringify({ type: "about:blank", title: "x", status, detail }), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });

function mockApi(mockFetch: FetchMock, overrides: (url: string, method: string) => Response | undefined = () => undefined) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const custom = overrides(String(url), method);
    if (custom) return Promise.resolve(custom);
    if (method === "GET") {
      if (url === "/api/v1/teams/5") return Promise.resolve(jsonResponse(200, TEAM));
      if (url === "/api/v1/teams/5/managers") return Promise.resolve(jsonResponse(200, { items: MANAGERS }));
      if (url === "/api/v1/teams/5/memberships") return Promise.resolve(jsonResponse(200, { items: MEMBERSHIPS }));
      if (String(url).startsWith("/api/v1/users?"))
        return Promise.resolve(jsonResponse(200, { items: USERS, page: 1, pageSize: 100, total: USERS.length }));
    }
    if (method === "POST") return Promise.resolve(jsonResponse(201, MEMBERSHIPS[0]));
    if (method === "PUT" || method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(jsonResponse(404, {}));
  });
}

function renderPage(route = "/teams/5/history") {
  return renderWithProviders(
    <Routes>
      <Route path="/teams/:id/history" element={<TeamHistory />} />
    </Routes>,
    { route },
  );
}

// The dropdown of one picker: both sections mount a Select, so find the listbox the input owns.
async function listboxOf(input: HTMLElement): Promise<HTMLElement> {
  const id = input.getAttribute("aria-controls");
  await waitFor(() => expect(id && document.getElementById(id)).toBeTruthy());
  return document.getElementById(id ?? "") as HTMLElement;
}

const writes = (mockFetch: FetchMock, method: string) =>
  mockFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === method);

describe("TeamHistory page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(USER_ID_KEY, "1");
    localStorage.setItem(ROLE_KEY, JSON.stringify(["ADMIN"]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders the manager timeline newest first and the membership table with Current / Past / Upcoming pills", async () => {
    mockApi(mockFetch);
    renderPage();

    expect(await screen.findByRole("heading", { name: "History of Platform" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Managers" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Membership history" })).toBeInTheDocument();

    // Timeline: the current manager first (with the badge), then the earlier one whose open
    // start reads "Before records began – <end>".
    const region = (await screen.findByRole("region", { name: "Managers" })) as HTMLElement;
    const managers = region.querySelector(".mantine-Timeline-root") as HTMLElement;
    const bob = await within(managers).findByText("Bob Boss");
    const mona = within(managers).getByText("Mona Manager");
    expect(bob.compareDocumentPosition(mona) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(managers).getByText("Current", { selector: ".mantine-Badge-label" })).toBeInTheDocument();
    expect(within(managers).getByText(/^Before records began – /)).toBeInTheDocument();
    expect(within(managers).getByText(/^Since /)).toBeInTheDocument();

    // Table: upcoming, current, past — newest first — each with its pill.
    const rows = (await screen.findAllByRole("row")).slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Soon Sam")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Upcoming")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Current Cy")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Current")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Open-ended")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Past Pat")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Past")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Before records began")).toBeInTheDocument();
  });

  test("the back link returns to the team details, or to the page that sent us here", async () => {
    mockApi(mockFetch);
    const first = renderPage();
    expect(await screen.findByRole("link", { name: "← Back to Team details" })).toHaveAttribute("href", "/teams/5/details");
    first.unmount();

    renderPage("/teams/5/history?back=%2Forg");
    expect(await screen.findByRole("link", { name: /^← Back to /})).toHaveAttribute("href", "/org");
  });

  test("non-admins read the history but get no forms and no row actions", async () => {
    localStorage.setItem(ROLE_KEY, "[]");
    mockApi(mockFetch);
    renderPage();

    expect(await screen.findByText("Soon Sam")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add manager period" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add membership period" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit manager period/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit membership of/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^More actions for/ })).not.toBeInTheDocument();
  });

  test("admin adds a manager period from a date (POST), offering only active people", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Soon Sam");

    const picker = screen.getByPlaceholderText("Pick a manager");
    await user.click(picker);
    const listbox = await listboxOf(picker);
    // The deactivated person is never offered for a NEW reference.
    expect(within(listbox).queryByText("Dormant Dee")).not.toBeInTheDocument();
    await user.click(within(listbox).getByText("Newcomer Nia"));
    const starts = screen.getByLabelText("Starts on");
    fireEvent.change(starts, { target: { value: NEXT_MONTH } });
    fireEvent.blur(starts);
    await user.click(screen.getByRole("button", { name: "Add manager period" }));

    await waitFor(() => expect(writes(mockFetch, "POST")).toHaveLength(1));
    const [url, init] = writes(mockFetch, "POST")[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/teams/5/managers");
    expect(JSON.parse(String(init.body))).toEqual({ managerId: 24, startDate: NEXT_MONTH });
    // The write refetches the line.
    await waitFor(() =>
      expect(mockFetch.mock.calls.filter(([u]) => u === "/api/v1/teams/5/managers").length).toBeGreaterThanOrEqual(2),
    );
  });

  test("a clearable start sends null (since before records) when emptied", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Soon Sam");

    const picker = screen.getByPlaceholderText("Pick a user");
    await user.click(picker);
    const listbox = await listboxOf(picker);
    await user.click(within(listbox).getByText("Newcomer Nia"));
    const from = screen.getByLabelText("From");
    fireEvent.change(from, { target: { value: "" } });
    fireEvent.blur(from);
    await user.click(screen.getByRole("button", { name: "Add membership period" }));

    await waitFor(() => expect(writes(mockFetch, "POST")).toHaveLength(1));
    const [url, init] = writes(mockFetch, "POST")[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/teams/5/memberships");
    expect(JSON.parse(String(init.body))).toEqual({ userId: 24, startDate: null, endDate: null });
  });

  test("a 409 from the server is shown inline with its detail, and nothing else changes", async () => {
    const detail = "Pat already has a membership period overlapping these dates";
    mockApi(mockFetch, (_url, method) => (method === "POST" ? problem(409, detail) : undefined));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Soon Sam");

    const picker = screen.getByPlaceholderText("Pick a user");
    await user.click(picker);
    const listbox = await listboxOf(picker);
    await user.click(within(listbox).getByText("Newcomer Nia"));
    await user.click(screen.getByRole("button", { name: "Add membership period" }));

    expect(await screen.findByText(detail)).toBeInTheDocument();
  });

  test("editing a membership keeps the person fixed and PUTs the corrected dates", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Soon Sam");

    await user.click(screen.getByRole("button", { name: /^Edit membership of Past Pat,/ }));
    expect(screen.getByText("Edit membership period")).toBeInTheDocument();
    const until = screen.getByLabelText("Until");
    fireEvent.change(until, { target: { value: TODAY } });
    fireEvent.blur(until);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(writes(mockFetch, "PUT")).toHaveLength(1));
    const [url, init] = writes(mockFetch, "PUT")[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/teams/5/memberships/31");
    expect(JSON.parse(String(init.body))).toEqual({ startDate: null, endDate: TODAY });
  });

  test("deleting a membership confirms, then DELETEs", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Soon Sam");

    await user.click(screen.getByRole("button", { name: "More actions for Soon Sam" }));
    await user.click(await screen.findByRole("menuitem", { name: /^Delete membership of Soon Sam,/ }));
    const dialog = await screen.findByRole("dialog", { name: "Delete membership period?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(writes(mockFetch, "DELETE")).toHaveLength(1));
    expect(String(writes(mockFetch, "DELETE")[0][0])).toBe("/api/v1/teams/5/memberships/33");
  });

  test("editing and deleting a manager period use the periods endpoint; a refused delete explains itself", async () => {
    const detail = "A team must keep at least one manager period";
    mockApi(mockFetch, (url, method) =>
      method === "DELETE" && url === "/api/v1/teams/5/managers/2" ? problem(409, detail) : undefined,
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Soon Sam");

    await user.click(screen.getByRole("button", { name: /^Edit manager period of Mona Manager,/ }));
    expect(screen.getByText("Edit manager period")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(mockFetch, "PUT")).toHaveLength(1));
    const [url, init] = writes(mockFetch, "PUT")[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/teams/5/managers/1");
    expect(JSON.parse(String(init.body))).toEqual({ managerId: 10, startDate: null });

    await user.click(screen.getByRole("button", { name: /^Delete manager period of Bob Boss,/ }));
    const dialog = await screen.findByRole("dialog", { name: "Delete manager period?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await within(dialog).findByText(detail)).toBeInTheDocument();
  });

  test("deleting the row being edited returns to the add form: the next submit is a POST, not a PUT", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Soon Sam");

    await user.click(screen.getByRole("button", { name: /^Edit membership of Past Pat,/ }));
    expect(screen.getByText("Edit membership period")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More actions for Past Pat" }));
    await user.click(await screen.findByRole("menuitem", { name: /^Delete membership of Past Pat,/ }));
    const dialog = await screen.findByRole("dialog", { name: "Delete membership period?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(writes(mockFetch, "DELETE")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText("Edit membership period")).not.toBeInTheDocument());

    const picker = screen.getByPlaceholderText("Pick a user");
    await user.click(picker);
    await user.click(within(await listboxOf(picker)).getByText("Newcomer Nia"));
    await user.click(screen.getByRole("button", { name: "Add membership period" }));
    await waitFor(() => expect(writes(mockFetch, "POST")).toHaveLength(1));
    expect(writes(mockFetch, "PUT")).toHaveLength(0);
  });

  test("an unrelated delete does not wipe what was typed into the add form", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Soon Sam");

    const picker = screen.getByPlaceholderText("Pick a user");
    await user.click(picker);
    await user.click(within(await listboxOf(picker)).getByText("Newcomer Nia"));
    await user.click(screen.getByRole("button", { name: "More actions for Soon Sam" }));
    await user.click(await screen.findByRole("menuitem", { name: /^Delete membership of Soon Sam,/ }));
    const dialog = await screen.findByRole("dialog", { name: "Delete membership period?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(writes(mockFetch, "DELETE")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(screen.getByPlaceholderText("Pick a user")).toHaveValue("Newcomer Nia");
  });

  test("Include inactive people offers deactivated people; the server's 400 for today-or-later shows inline", async () => {
    const detail = "A deactivated person cannot be assigned from today onward";
    mockApi(mockFetch, (_url, method) => (method === "POST" ? problem(400, detail) : undefined));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Soon Sam");
    const members = within(screen.getByRole("region", { name: "Membership history" }));

    const picker = screen.getByPlaceholderText("Pick a user");
    await user.click(picker);
    expect(within(await listboxOf(picker)).queryByText("Dormant Dee")).not.toBeInTheDocument();
    await user.click(members.getByRole("checkbox", { name: "Include inactive people" }));
    await user.click(picker);
    await user.click(within(await listboxOf(picker)).getByText("Dormant Dee"));
    await user.click(screen.getByRole("button", { name: "Add membership period" }));

    expect(await screen.findByText(detail)).toBeInTheDocument();
    const body = JSON.parse(String((writes(mockFetch, "POST")[0] as [string, RequestInit])[1].body));
    expect(body.userId).toBe(25);
  });

  test("the manager picker has the same Include inactive people switch (off by default)", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Soon Sam");
    const managers = within(screen.getByRole("region", { name: "Managers" }));

    const picker = screen.getByPlaceholderText("Pick a manager");
    const box = managers.getByRole("checkbox", { name: "Include inactive people" });
    expect(box).not.toBeChecked();
    await user.click(picker);
    expect(within(await listboxOf(picker)).queryByText("Dormant Dee")).not.toBeInTheDocument();
    await user.click(box);
    await user.click(picker);
    expect(within(await listboxOf(picker)).getByText("Dormant Dee")).toBeInTheDocument();
  });

  test("clearing the start of an existing manager period PUTs null", async () => {
    mockApi(mockFetch);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Soon Sam");

    await user.click(screen.getByRole("button", { name: /^Edit manager period of Bob Boss,/ }));
    const starts = screen.getByLabelText("Starts on");
    expect(starts).toHaveValue(LONG_AGO);
    fireEvent.change(starts, { target: { value: "" } });
    fireEvent.blur(starts);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(writes(mockFetch, "PUT")).toHaveLength(1));
    const [url, init] = writes(mockFetch, "PUT")[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/teams/5/managers/2");
    expect(JSON.parse(String(init.body))).toEqual({ managerId: 11, startDate: null });
  });

  test("a missing team shows the not-found message", async () => {
    mockApi(mockFetch, (url) => (url === "/api/v1/teams/5" ? jsonResponse(404, {}) : undefined));
    renderPage();
    expect(await screen.findByText("Team not found.")).toBeInTheDocument();
  });
});
