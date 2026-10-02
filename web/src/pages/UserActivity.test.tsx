import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { cleanup, fireEvent, renderWithProviders, screen, waitFor } from "../test/render";
import { jsonResponse } from "../test/http";
import UserActivity from "./UserActivity";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

function Probe() {
  const location = useLocation();
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

const ENTRY = {
  id: "GOAL:EVENT:5",
  createdAt: new Date(2026, 8, 1, 10, 0).getTime(),
  area: "GOAL",
  eventType: "PROGRESS_UPDATED",
  params: { from: "10.0", to: "20.0" },
  documentId: 5,
  link: "/goals/5/view",
  details: { title: "Raise coverage", subordinate: "Riley Report" },
  subjectUserId: null,
  subjectUserName: null,
};

function mockApi(activityStatus = 200) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      const url = String(input);
      if (url.startsWith("/api/v1/users?")) {
        return Promise.resolve(
          jsonResponse(200, {
            items: [{ id: 9, name: "Riley Report", email: "riley@example.com", roles: [] }],
            page: 1,
            pageSize: 100,
            total: 1,
          }),
        );
      }
      if (/^\/api\/v1\/users\/\d+\/activity\?/.test(url)) {
        urls.push(url);
        if (activityStatus !== 200) return Promise.resolve(jsonResponse(activityStatus, { title: "x" }));
        return Promise.resolve(jsonResponse(200, { items: [ENTRY], page: 1, pageSize: 20, total: 1 }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    }),
  );
  return urls;
}

function renderPage(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/users/:userId/activity" element={<UserActivity />} />
      <Route path="*" element={<Probe />} />
    </Routes>,
    { route },
  );
}

describe("UserActivity page", () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("report flavor: names the person from the pool, lists their log, persists under userActivity.managed", async () => {
    const urls = mockApi();
    const user = userEvent.setup();
    renderPage("/users/9/activity?name=Riley&from=subordinates&manages=1");

    expect(await screen.findByRole("heading", { level: 2, name: "Activity of Riley Report" })).toBeInTheDocument();
    expect(screen.getByText(/limited to the documents you can read yourself/)).toBeInTheDocument();
    expect(await screen.findByText("Progress updated from 10 to 20.")).toBeInTheDocument();
    expect(urls[0]).toBe("/api/v1/users/9/activity?page=1&pageSize=20&sort=-createdAt");
    // The origin names the back link (the subordinates grid).
    expect(screen.getByRole("link", { name: /Back to/ })).toHaveAttribute("href", "/?tab=subordinates");

    await user.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(screen.getByLabelText("Area", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "Goal" }));
    await waitFor(() => expect(urls[urls.length - 1]).toContain("area=GOAL"));
    expect(localStorage.getItem("lettuce.viewSettings.userActivity.managed.filter.area")).toContain("GOAL");
  });

  test("audit flavor (HR, mode=audit): the auditor title and hint, persisted under userActivity.audit", async () => {
    localStorage.setItem(ROLE_KEY, JSON.stringify(["HR"]));
    const urls = mockApi();
    const user = userEvent.setup();
    renderPage("/users/9/activity?name=Riley&from=details&mode=audit");

    expect(await screen.findByText(/The auditor view: everything Riley Report did/)).toBeInTheDocument();
    expect(await screen.findByText("Progress updated from 10 to 20.")).toBeInTheDocument();
    // from=details returns to the person's details page.
    expect(screen.getByRole("link", { name: /Back to/ })).toHaveAttribute("href", expect.stringMatching(/^\/users\/9\/details/));

    await user.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(screen.getByLabelText("Area", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "Goal" }));
    await waitFor(() => expect(urls[urls.length - 1]).toContain("area=GOAL"));
    expect(localStorage.getItem("lettuce.viewSettings.userActivity.audit.filter.area")).toContain("GOAL");
    expect(localStorage.getItem("lettuce.viewSettings.userActivity.managed.filter.area")).toBeNull();
  });

  test("an HR viewer always gets the auditor flavor, even without ?mode=audit (HR is checked before the chain server-side)", async () => {
    localStorage.setItem(ROLE_KEY, JSON.stringify(["HR"]));
    mockApi();
    renderPage("/users/9/activity?name=Riley&from=subordinates&manages=1");
    expect(await screen.findByRole("heading", { level: 2, name: "Activity of Riley Report (audit)" })).toBeInTheDocument();
    expect(screen.getByText(/The auditor view: everything Riley Report did/)).toBeInTheDocument();
    expect(screen.queryByText(/limited to the documents you can read yourself/)).toBeNull();
  });

  test("mode=audit from a non-auditor silently falls back to the report flavor", async () => {
    mockApi();
    renderPage("/users/9/activity?name=Riley&from=details&mode=audit");
    expect(await screen.findByText(/limited to the documents you can read yourself/)).toBeInTheDocument();
    expect(screen.queryByText(/The auditor view/)).toBeNull();
  });

  test("a 403 (a peer opening the URL) renders the ordinary permission message, never an empty log", async () => {
    mockApi(403);
    renderPage("/users/9/activity?name=Riley");
    expect(await screen.findByText("You don't have permission to view this activity log.")).toBeInTheDocument();
    expect(screen.queryByText("No activity yet.")).toBeNull();
    expect(screen.queryByText(/Couldn't load the activity/)).toBeNull();
  });

  test("one's own id belongs to the nav page; a malformed id goes back to the origin", async () => {
    mockApi();
    renderPage("/users/7/activity?name=Me");
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/activity"));
    cleanup();

    renderPage("/users/abc/activity?from=subordinates");
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/?tab=subordinates"));
  });

  test("an id missing from the pool falls back to 'user #id' instead of a URL-carried name", async () => {
    mockApi();
    renderPage("/users/12/activity?name=Mallory");
    expect(await screen.findByRole("heading", { level: 2, name: "Activity of user #12" })).toBeInTheDocument();
  });
});
