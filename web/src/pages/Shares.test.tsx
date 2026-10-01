import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { notifications } from "@mantine/notifications";
import { Route, Routes, useLocation } from "react-router-dom";
import { cleanup, fireEvent, renderWithProviders, screen, waitFor, within } from "../test/render";
import { jsonResponse } from "../test/http";
import Shares from "./Shares";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

function Probe() {
  const location = useLocation();
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

const row = (id: number, resourceType: string, details: Record<string, string> | null, extra: Record<string, unknown> = {}) => ({
  id,
  resourceType,
  resourceId: 40 + id,
  sharerId: 3,
  sharerName: "Sue Sharer",
  shareeId: 7,
  shareeName: "Me",
  expiresOn: null,
  createdAt: new Date(2026, 8, 1).getTime(),
  status: "ACTIVE",
  withdrawnAt: null,
  withdrawnById: null,
  withdrawnByName: null,
  link: `/x/${40 + id}/view`,
  details,
  ...extra,
});

const WITH_ME = [
  row(1, "FEEDBACK", { provider: "Pat Provider", subjects: "Ann, Ben" }, { link: "/feedback/41/view" }),
  row(2, "ONE_ON_ONE", { manager: "Mia Manager", subordinate: "Sam Sub", meetingDate: "2026-07-01" }, { link: "/one-on-ones/42/view" }),
  row(3, "GOAL", { title: "Raise coverage", subordinate: "Sam Sub" }, { expiresOn: "2099-12-31", link: "/goals/43/view" }),
  row(4, "PERFORMANCE_REVIEW", { subordinate: "Sam Sub", startMonth: "2026-01", endMonth: "2026-06" }),
  row(5, "TEAM_KPI", { title: "Deploy weekly", team: "Team AAA" }),
  row(6, "IMPACT_LOG_ENTRY", { title: "Pipeline shipped", author: "Olga Owner", periodStart: "2026-07-01", periodEnd: "2026-07-31" }),
  row(7, "SUCCESSION_PLAN", { person: "Sam Seat", owner: "Mona Manager" }),
  row(8, "GOAL", null, { status: "EXPIRED", expiresOn: "2020-01-31", link: "/goals/48/view" }),
];

const BY_ME = [
  row(11, "GOAL", { title: "Raise coverage", subordinate: "Sam Sub" }, { sharerId: 7, sharerName: "Me", shareeId: 12, shareeName: "Ben Bystander", link: "/goals/51/view" }),
  row(12, "GOAL", { title: "Old goal", subordinate: "Sam Sub" }, { sharerId: 7, sharerName: "Me", shareeId: 13, shareeName: "Cy Expired", status: "EXPIRED", expiresOn: "2020-01-31", link: "/goals/52/view" }),
  row(13, "FEEDBACK", { provider: "Me", subjects: "Ann" }, { sharerId: 7, sharerName: "Me", shareeId: 14, shareeName: "Wes Withdrawn", status: "WITHDRAWN", link: "/feedback/53/view" }),
];

type Reply = { items: unknown[]; status?: number; total?: number };

function mockApi(replies: { withMe?: Reply; byMe?: Reply; withdrawStatus?: number } = {}) {
  const calls: { method: string; url: string }[] = [];
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    if (method === "POST" && /\/withdraw$/.test(url)) {
      const status = replies.withdrawStatus ?? 204;
      return Promise.resolve(
        status === 204
          ? new Response(null, { status })
          : new Response(JSON.stringify({ title: "x", status }), { status, headers: { "Content-Type": "application/problem+json" } }),
      );
    }
    if (url.startsWith("/api/v1/shares?")) {
      const view = new URL(url, "http://x").searchParams.get("view");
      const reply = view === "byMe" ? (replies.byMe ?? { items: BY_ME }) : (replies.withMe ?? { items: WITH_ME });
      if (reply.status && reply.status !== 200) return Promise.resolve(jsonResponse(reply.status, { title: "x" }));
      return Promise.resolve(jsonResponse(200, { items: reply.items, page: 1, pageSize: 20, total: reply.total ?? reply.items.length }));
    }
    return Promise.resolve(jsonResponse(200, {}));
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function renderPage(route = "/shares") {
  return renderWithProviders(
    <Routes>
      <Route
        path="/shares"
        element={
          <>
            <Shares />
            <Probe />
          </>
        }
      />
    </Routes>,
    { route },
  );
}

const listUrls = (calls: { url: string }[]) => calls.filter((c) => c.url.startsWith("/api/v1/shares?")).map((c) => c.url);

describe("Shares page", () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  test("defaults to Shared with me: queries view=withMe newest first and shows the sharer", async () => {
    const calls = mockApi();
    renderPage();

    expect(await screen.findByText("Raise coverage (Sam Sub)")).toBeInTheDocument();
    expect(listUrls(calls)[0]).toBe("/api/v1/shares?view=withMe&page=1&pageSize=20&sort=-createdAt");
    expect(screen.getByRole("tab", { name: "Shared with me" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("columnheader", { name: "Shared by" })).toBeInTheDocument();
    // The counterpart is the sharer.
    expect(screen.getAllByText("Sue Sharer").length).toBeGreaterThan(0);
  });

  test("localizes the document label per kind from the details snapshot, and null details read as unavailable", async () => {
    mockApi();
    renderPage();

    await screen.findByText("Raise coverage (Sam Sub)");
    expect(screen.getByText("From Pat Provider to Ann, Ben")).toBeInTheDocument();
    expect(screen.getByText("Mia Manager and Sam Sub, Jul 1, 2026")).toBeInTheDocument();
    expect(screen.getByText("Sam Sub, January 2026 – June 2026")).toBeInTheDocument();
    expect(screen.getByText("Deploy weekly (Team AAA)")).toBeInTheDocument();
    expect(screen.getByText("Pipeline shipped (Olga Owner, Jul 1, 2026 – Jul 31, 2026)")).toBeInTheDocument();
    expect(screen.getByText("Sam Seat (owner: Mona Manager)")).toBeInTheDocument();
    expect(screen.getByText("No longer available")).toBeInTheDocument();
    // The type pill names each kind.
    for (const name of ["Feedback", "1:1 meeting", "Performance review", "Team KPI", "Impact log entry", "Succession plan"]) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
    // Until / no end.
    expect(screen.getByText("Dec 31, 2099")).toBeInTheDocument();
    expect(screen.getAllByText("No end date").length).toBeGreaterThan(0);
  });

  test("Open links to the share's link with a back= to this very tab; an EXPIRED withMe row has no Open", async () => {
    mockApi();
    renderPage();

    const open = await screen.findByRole("link", { name: "Open the shared document: Raise coverage (Sam Sub)" });
    expect(open).toHaveAttribute("href", `/goals/43/view?back=${encodeURIComponent("/shares")}`);
    // The expired row (null details → "No longer available") offers no Open.
    expect(screen.queryByRole("link", { name: "Open the shared document: No longer available" })).toBeNull();
    // Nothing is withdrawable from this tab.
    expect(screen.queryByRole("button", { name: /Withdraw/ })).toBeNull();
  });

  test("?tab=byMe opens Shared by me, shows the sharee, and the tab click rewrites the URL", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderPage("/shares?tab=byMe");

    expect(await screen.findByText("Ben Bystander")).toBeInTheDocument();
    expect(listUrls(calls)[0]).toContain("view=byMe");
    expect(screen.getByRole("columnheader", { name: "Shared with" })).toBeInTheDocument();
    // byMe shows every status, and Open stays for the sharer on every row.
    expect(screen.getByText("Withdrawn")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the shared document: Old goal (Sam Sub)" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Shared with me" }));
    expect(screen.getByTestId("probe")).toHaveTextContent("/shares?tab=withMe");
    expect(await screen.findByText("Raise coverage (Sam Sub)")).toBeInTheDocument();
  });

  test("an unknown tab value falls back to Shared with me", async () => {
    const calls = mockApi();
    renderPage("/shares?tab=bogus");
    await screen.findByText("Raise coverage (Sam Sub)");
    expect(listUrls(calls)[0]).toContain("view=withMe");
  });

  test("withdraw (byMe, ACTIVE only) asks first, then POSTs, toasts and refetches the lists", async () => {
    const calls = mockApi();
    const toast = vi.spyOn(notifications, "show");
    const user = userEvent.setup();
    renderPage("/shares?tab=byMe");
    await screen.findByText("Ben Bystander");

    // Only the ACTIVE row carries a Withdraw; its ⋯ menu holds it.
    expect(screen.getAllByRole("button", { name: /^More actions for/ })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "More actions for Raise coverage (Sam Sub)" }));
    await user.click(await screen.findByRole("menuitem", { name: "Withdraw the share with Ben Bystander" }));
    expect(screen.getByText("Withdraw this share?")).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith("/withdraw"))).toBe(false);

    const before = listUrls(calls).length;
    await user.click(screen.getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/api/v1/shares/11/withdraw")).toBe(true));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: "Share withdrawn" })));
    await waitFor(() => expect(listUrls(calls).length).toBeGreaterThan(before));
  });

  test("a failed withdraw shows its reason inline and still refetches", async () => {
    const calls = mockApi({ withdrawStatus: 409 });
    const user = userEvent.setup();
    renderPage("/shares?tab=byMe");
    await screen.findByText("Ben Bystander");

    await user.click(screen.getByRole("button", { name: "More actions for Raise coverage (Sam Sub)" }));
    await user.click(await screen.findByRole("menuitem", { name: "Withdraw the share with Ben Bystander" }));
    const before = listUrls(calls).length;
    await user.click(screen.getByRole("button", { name: "Withdraw" }));

    expect(await screen.findByText("This share is already withdrawn.")).toBeInTheDocument();
    await waitFor(() => expect(listUrls(calls).length).toBeGreaterThan(before));
  });

  test("the type and status filters ride the query and persist per tab; withMe offers no Withdrawn status", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Raise coverage (Sam Sub)");

    await user.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(screen.getByLabelText("Document type", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "Goal" }));
    await waitFor(() => expect(listUrls(calls).some((u) => u.includes("resourceType=GOAL"))).toBe(true));

    fireEvent.click(screen.getByLabelText("Status", { selector: "input" }));
    expect(screen.queryByRole("option", { name: "Withdrawn" })).toBeNull();
    fireEvent.click(await screen.findByRole("option", { name: "Active" }));
    await waitFor(() => expect(listUrls(calls).some((u) => u.includes("status=ACTIVE"))).toBe(true));

    expect(localStorage.getItem("lettuce.viewSettings.shares.withMe.filter.type")).toContain("GOAL");
    expect(localStorage.getItem("lettuce.viewSettings.shares.withMe.filter.status")).toContain("ACTIVE");
    // The other tab's settings are its own.
    expect(localStorage.getItem("lettuce.viewSettings.shares.byMe.filter.type")).toBeNull();
  });

  test("changing a filter resets the page to 1", async () => {
    const calls = mockApi({ withMe: { items: WITH_ME, total: 45 } });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Raise coverage (Sam Sub)");

    await user.click(screen.getByRole("button", { name: "2" }));
    await waitFor(() => expect(listUrls(calls).some((u) => u.includes("page=2"))).toBe(true));

    await user.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(screen.getByLabelText("Status", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "Active" }));
    await waitFor(() => expect(listUrls(calls).at(-1)).toContain("status=ACTIVE"));
    expect(listUrls(calls).at(-1)).toContain("page=1");
  });

  test("byMe offers the Withdrawn status filter", async () => {
    mockApi();
    const user = userEvent.setup();
    renderPage("/shares?tab=byMe");
    await screen.findByText("Ben Bystander");

    await user.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(screen.getByLabelText("Status", { selector: "input" }));
    expect(await screen.findByRole("option", { name: "Withdrawn" })).toBeInTheDocument();
  });

  test("a kind whose feature the viewer disabled is missing from the type filter; its byMe row stays withdrawable but has no Open", async () => {
    localStorage.setItem("lettuce.auth.disabledFeatures", JSON.stringify(["GOALS"]));
    mockApi();
    const user = userEvent.setup();
    renderPage("/shares?tab=byMe");
    await screen.findByText("Ben Bystander");

    // The Goal rows are listed (the sharer may still withdraw) ...
    expect(screen.getByText("Raise coverage (Sam Sub)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More actions for Raise coverage (Sam Sub)" })).toBeInTheDocument();
    // ... but never open (the area bounces them to the dashboard); the Feedback row still does.
    expect(screen.queryByRole("link", { name: "Open the shared document: Raise coverage (Sam Sub)" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open the shared document: From Me to Ann" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(screen.getByLabelText("Document type", { selector: "input" }));
    expect(await screen.findByRole("option", { name: "Feedback" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Goal" })).toBeNull();
  });

  test("clicking the Until and Shared-on headers toggles the sort param", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Raise coverage (Sam Sub)");

    await user.click(screen.getByRole("button", { name: /Shared on/ }));
    await waitFor(() => expect(listUrls(calls).some((u) => u.includes("sort=createdAt&") || u.endsWith("sort=createdAt"))).toBe(true));
    await user.click(screen.getByRole("button", { name: /Until/ }));
    await waitFor(() => expect(listUrls(calls).some((u) => u.includes("sort=expiresOn"))).toBe(true));
  });

  test("empty states: nothing shared with me, nothing shared by me, and a filtered-empty note", async () => {
    mockApi({ withMe: { items: [] }, byMe: { items: [] } });
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("Nothing has been shared with you.")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Shared by me" }));
    expect(await screen.findByText("You haven't shared anything.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(screen.getByLabelText("Status", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "Expired" }));
    expect(await screen.findByText("No shares match these filters.")).toBeInTheDocument();
  });

  test("a failed load is an error alert, never a silent blank", async () => {
    mockApi({ withMe: { items: [], status: 500 } });
    renderPage();
    const alert = await screen.findByText("Couldn't load the shared documents.");
    expect(within(alert.closest("[role=alert]") as HTMLElement).getByText(/Loading failed \(500\)\./)).toBeInTheDocument();
    expect(screen.queryByText("Nothing has been shared with you.")).toBeNull();
  });
});
