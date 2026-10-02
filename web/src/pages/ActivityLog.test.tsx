import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { cleanup, fireEvent, renderWithProviders, screen, waitFor, within } from "../test/render";
import { jsonResponse } from "../test/http";
import ActivityLog from "./ActivityLog";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

const row = (
  id: string,
  area: string,
  eventType: string,
  params: Record<string, string> = {},
  extra: Record<string, unknown> = {},
) => ({
  id,
  createdAt: new Date(2026, 8, 1, 10, 0).getTime(),
  area,
  eventType,
  params,
  documentId: null,
  link: null,
  details: null,
  subjectUserId: null,
  subjectUserName: null,
  ...extra,
});

const ITEMS = [
  row("GOAL:EVENT:5", "GOAL", "PROGRESS_UPDATED", { from: "10.0", to: "20.0" }, {
    documentId: 5,
    link: "/goals/5/view",
    details: { title: "Raise coverage", subordinate: "Sam Sub" },
  }),
  // The log's owner can no longer read this goal: the fact stays, the label and link are gone.
  row("GOAL:EVENT:6", "GOAL", "DELETED", {}, { documentId: 6 }),
  row("FEEDBACK:SHARE:9", "FEEDBACK", "SHARE_CREATED", { sharee: "Ben Bystander", expiresOn: "2026-12-31" }, {
    documentId: 3,
    link: "/feedback/3/view",
    details: { provider: "Me", subjects: "Ann" },
  }),
  // A share stored without a snapshot still links, labelled generically.
  row("ONE_ON_ONE:SHARE_WITHDRAWAL:2", "ONE_ON_ONE", "SHARE_WITHDRAWN", { sharee: "Cy", byAuthor: "true", sharer: "Sue Sharer" }, {
    documentId: 2,
    link: "/one-on-ones/2/view",
  }),
  row("DAYS_OFF:EVENT:4", "DAYS_OFF", "ENTRY_RECORDED", {
    type: "PAID", poolName: "Vacation", startDate: "2026-08-03", endDate: "2026-08-07", days: "5.0", onBehalf: "true",
  }, { subjectUserId: 12, subjectUserName: "Ann Report" }),
  row("CAREER_POSITION:EVENT:7", "CAREER_POSITION", "POSITION_CREATED", {
    positionId: "7", startDate: "2026-01-01", seniorityLevel: "5", seniorityLevelName: "Senior",
  }, { subjectUserId: 12, subjectUserName: "Ann Report" }),
  row("ACCOUNT:EVENT:8", "ACCOUNT", "SIGNED_IN", { mfa: "true" }, { subjectUserId: 7, subjectUserName: "Me" }),
  row("ACCOUNT:EVENT:9", "ACCOUNT", "SIGNED_OUT"),
];

type Reply = { items?: unknown[]; status?: number; total?: number };

function mockApi(reply: Reply = {}) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      const url = String(input);
      if (url.startsWith("/api/v1/dictionaries/seniority-levels")) {
        return Promise.resolve(
          jsonResponse(200, { items: [{ id: 5, values: { en: "Senior (live)", pl: "Starszy (live)" } }] }),
        );
      }
      if (url.startsWith("/api/v1/dictionaries/")) return Promise.resolve(jsonResponse(200, { items: [] }));
      if (url.startsWith("/api/v1/users/7/activity?")) {
        urls.push(url);
        if (reply.status && reply.status !== 200) return Promise.resolve(jsonResponse(reply.status, { title: "x" }));
        const items = reply.items ?? ITEMS;
        return Promise.resolve(jsonResponse(200, { items, page: 1, pageSize: 20, total: reply.total ?? items.length }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    }),
  );
  return urls;
}

function renderPage(route = "/activity") {
  return renderWithProviders(
    <Routes>
      <Route path="/activity" element={<ActivityLog />} />
    </Routes>,
    { route },
  );
}

const last = (urls: string[]) => urls[urls.length - 1];

describe("ActivityLog page", () => {
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

  test("lists the caller's own log newest first with a real sentence per area", async () => {
    const urls = mockApi();
    renderPage();

    expect(await screen.findByText("Progress updated from 10 to 20.")).toBeInTheDocument();
    expect(urls[0]).toBe("/api/v1/users/7/activity?page=1&pageSize=20&sort=-createdAt");
    expect(screen.getByRole("heading", { level: 2, name: "My activity" })).toBeInTheDocument();
    expect(screen.getByText("Shared feedback with Ben Bystander until Dec 31, 2026")).toBeInTheDocument();
    expect(screen.getByText("Withdrew Sue Sharer's share of a 1:1 meeting with Cy")).toBeInTheDocument();
    expect(screen.getByText('Recorded days off Aug 3, 2026 – Aug 7, 2026 (5 days, paid, "Vacation" pool)')).toBeInTheDocument();
    expect(screen.getByText("Signed in (with a sign-in code)")).toBeInTheDocument();
    expect(screen.getByText("Signed out")).toBeInTheDocument();
    // The area pills (the filter's options are not mounted while it is closed).
    for (const name of ["Goal", "Feedback", "1:1 meeting", "Days off", "Career", "Sign-ins"]) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
  });

  test("document rows link to the document with a back= to this page; an unreadable document is a muted fallback", async () => {
    mockApi();
    renderPage();

    const goal = await screen.findByRole("link", { name: "Raise coverage (Sam Sub)" });
    expect(goal).toHaveAttribute("href", `/goals/5/view?back=${encodeURIComponent("/activity")}`);
    // Feedback share row: label from the stored snapshot.
    expect(screen.getByRole("link", { name: "From Me to Ann" })).toHaveAttribute("href", expect.stringContaining("/feedback/3/view?back="));
    // A share row with no snapshot still links, generically.
    expect(screen.getByRole("link", { name: "Open the document" })).toHaveAttribute("href", expect.stringContaining("/one-on-ones/2/view?back="));
    // The deleted-goal row: sentence stays, the document is "no longer available" (no link).
    expect(screen.getByText("Goal deleted.")).toBeInTheDocument();
    expect(screen.getAllByText("No longer available")).toHaveLength(1);
  });

  test("person-scoped rows name the person concerned when it is not the log's owner (career links to their career page)", async () => {
    mockApi();
    renderPage();

    await screen.findByText("Progress updated from 10 to 20.");
    // The accessible name carries the row's sentence, so identical person links stay distinguishable.
    const forAnn = screen.getAllByRole("link", { name: /^For Ann Report: / });
    expect(forAnn).toHaveLength(2);
    expect(forAnn[0]).toHaveAccessibleName(/Recorded days off/);
    expect(forAnn[1]).toHaveAccessibleName(/Recorded a career position/);
    expect(forAnn[0]).toHaveAttribute("href", expect.stringMatching(/^\/users\/12\/details\?/));
    expect(forAnn[1]).toHaveAttribute("href", expect.stringMatching(/^\/users\/12\/career\?/));
    // The caller's own sign-in names nobody.
    expect(screen.queryByRole("link", { name: /^For Me/ })).toBeNull();
  });

  test("a career row resolves the live dictionary label, with the frozen name as the fallback", async () => {
    mockApi();
    renderPage();
    // The dictionary loads after the page: the frozen "Senior" is replaced by the live label.
    expect(
      await screen.findByText("Recorded a career position starting Jan 1, 2026 (Senior (live))"),
    ).toBeInTheDocument();
  });

  test("the sort button flips newest/oldest and rides the sort param", async () => {
    const urls = mockApi();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Progress updated from 10 to 20.");

    // The visible text names the current order, the accessible name adds the action.
    const sort = screen.getByRole("button", { name: "Newest first (switch to oldest first)" });
    expect(sort).toHaveTextContent("Newest first");
    await user.click(sort);
    await waitFor(() => expect(last(urls)).toMatch(/sort=createdAt$/));
    expect(last(urls)).not.toContain("sort=-createdAt");
    expect(await screen.findByRole("button", { name: "Oldest first (switch to newest first)" })).toBeInTheDocument();
  });

  test("the area and date filters ride the query as local-day bounds and persist", async () => {
    const urls = mockApi();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Progress updated from 10 to 20.");

    await user.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(screen.getByLabelText("Area", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "Goal" }));
    await waitFor(() => expect(last(urls)).toContain("area=GOAL"));

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-01" } });
    fireEvent.blur(screen.getByLabelText("From"));
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-09-30" } });
    fireEvent.blur(screen.getByLabelText("To"));
    const gte = new Date(2026, 8, 1, 0, 0, 0, 0).getTime();
    const lte = new Date(2026, 8, 30, 23, 59, 59, 999).getTime();
    await waitFor(() => {
      expect(last(urls)).toContain(`createdAt%5Bgte%5D=${gte}`);
      expect(last(urls)).toContain(`createdAt%5Blte%5D=${lte}`);
    });

    expect(localStorage.getItem("lettuce.viewSettings.activity.own.filter.area")).toContain("GOAL");
    expect(localStorage.getItem("lettuce.viewSettings.activity.own.filter.from")).toContain("2026-09-01");
  });

  test("stored filters are restored on a fresh mount", async () => {
    localStorage.setItem("lettuce.viewSettings.activity.own.filter.area", JSON.stringify("DAYS_OFF"));
    localStorage.setItem("lettuce.viewSettings.activity.own.paging", JSON.stringify({ sortField: "createdAt", sortDir: "asc", pageSize: 40 }));
    const urls = mockApi();
    renderPage();
    await screen.findByText("Progress updated from 10 to 20.");
    expect(urls[0]).toContain("area=DAYS_OFF");
    expect(urls[0]).toContain("pageSize=40");
    expect(urls[0]).toContain("sort=createdAt");
    expect(urls[0]).not.toContain("sort=-createdAt");
  });

  test("an area the viewer has disabled is not offered; ungated areas always are", async () => {
    localStorage.setItem("lettuce.auth.disabledFeatures", JSON.stringify(["GOALS", "DAYS_OFF"]));
    mockApi();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Progress updated from 10 to 20.");

    await user.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(screen.getByLabelText("Area", { selector: "input" }));
    expect(await screen.findByRole("option", { name: "Feedback" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Career" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Sign-ins" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Goal" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Days off" })).toBeNull();
  });

  test("an inverted date range shows only the message — no stale rows, no total — and sends no request for it", async () => {
    const urls = mockApi();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Progress updated from 10 to 20.");

    await user.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-30" } });
    fireEvent.blur(screen.getByLabelText("From"));
    await waitFor(() => expect(urls.some((u) => u.includes("createdAt%5Bgte%5D"))).toBe(true));
    const sent = urls.length;
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-09-01" } });
    fireEvent.blur(screen.getByLabelText("To"));

    expect(await screen.findByText("The start date is after the end date.")).toBeInTheDocument();
    // The previous page's rows and the pager are gone (they would describe a different filter).
    expect(screen.queryByText("Progress updated from 10 to 20.")).toBeNull();
    expect(screen.queryByText(/total:/)).toBeNull();
    // The inverted pair itself never reached the server.
    expect(urls).toHaveLength(sent);
    expect(urls.some((u) => u.includes("createdAt%5Blte%5D"))).toBe(false);
  });

  test("a row of an area this build does not know shows its raw name and the raw event type, never a key", async () => {
    mockApi({ items: [row("WIDGET:EVENT:1", "WIDGET", "FROBNICATED")] });
    renderPage();
    expect(await screen.findByText("FROBNICATED")).toBeInTheDocument();
    expect(screen.getByText("WIDGET")).toBeInTheDocument();
    expect(screen.queryByText(/activity\.area/)).toBeNull();
  });

  test("pagination: the pager fetches the requested page and a filter change returns to page 1", async () => {
    const urls = mockApi({ total: 45 });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Progress updated from 10 to 20.");

    await user.click(screen.getByRole("button", { name: "2" }));
    await waitFor(() => expect(last(urls)).toContain("page=2"));

    await user.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(screen.getByLabelText("Area", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "Feedback" }));
    await waitFor(() => expect(last(urls)).toContain("area=FEEDBACK"));
    expect(last(urls)).toContain("page=1");
  });

  test("empty, filtered-empty and failed loads each read honestly", async () => {
    mockApi({ items: [] });
    const user = userEvent.setup();
    const first = renderPage();
    expect(await screen.findByText("No activity yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(screen.getByLabelText("Area", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "Goal" }));
    expect(await screen.findByText("No activity matches these filters.")).toBeInTheDocument();
    first.unmount();
    localStorage.clear();
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(USER_ID_KEY, "7");

    mockApi({ status: 500 });
    renderPage();
    const alert = await screen.findByText("Couldn't load the activity.");
    expect(within(alert.closest("[role=alert]") as HTMLElement).getByText(/Loading failed \(500\)\./)).toBeInTheDocument();
    expect(screen.queryByText("No activity yet.")).toBeNull();
  });
});
