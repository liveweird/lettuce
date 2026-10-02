import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { renderWithProviders } from "../test/render";
import { jsonResponse } from "../test/http";
import type { ShareCandidate } from "../api/reviews";
import MassSharePerformanceReviews from "./MassSharePerformanceReviews";

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";
const DISABLED_KEY = "lettuce.auth.disabledFeatures";
const ROUTE = "/performance-reviews/mass-share?periodId=5";

const PERIODS = [
  { id: 4, startMonth: "2025-07", endMonth: "2025-12" },
  { id: 5, startMonth: "2026-01", endMonth: "2026-06" },
];

const entry = (id: number, en: string) => ({ id, values: { en } });

function cand(userId: number, name: string, extra: Partial<ShareCandidate> = {}): ShareCandidate {
  return {
    userId,
    name,
    email: `${name.toLowerCase().replace(/\s/g, ".")}@x.test`,
    deactivated: false,
    teams: [{ id: 1, name: "AAA" }],
    directManagers: [{ id: 7, name: "Me Caller" }],
    careerPath: null,
    careerSpecialization: null,
    seniorityLevel: null,
    review: {
      id: userId * 10,
      status: "PUBLISHED",
      managerId: 7,
      managerName: "Me Caller",
      attitudeRating: null,
      deliveryRating: null,
      skillsRating: null,
      aptitudeRating: null,
      overallRating: 4,
    },
    shareable: true,
    reason: null,
    ...extra,
  };
}

const CANDIDATES: ShareCandidate[] = [
  cand(1, "Ann Alpha", {
    careerPath: entry(11, "Software Engineer"),
    careerSpecialization: entry(21, "Backend"),
    seniorityLevel: entry(31, "Senior"),
    review: { id: 10, status: "PUBLISHED", managerId: 7, managerName: "Me Caller", attitudeRating: null, deliveryRating: null, skillsRating: null, aptitudeRating: null, overallRating: 5 },
  }),
  cand(2, "Ben Beta", {
    teams: [{ id: 2, name: "BBB" }],
    review: { id: 20, status: "DRAFT", managerId: 7, managerName: "Me Caller", attitudeRating: null, deliveryRating: null, skillsRating: null, aptitudeRating: null, overallRating: null },
  }),
  cand(3, "Cy Gamma", { review: null, shareable: false, reason: "NO_REVIEW" }),
  cand(4, "Dee Delta", {
    deactivated: true,
    review: { id: null, status: "DRAFT", managerId: null, managerName: "Olga Other", attitudeRating: null, deliveryRating: null, skillsRating: null, aptitudeRating: null, overallRating: null },
    shareable: false,
    reason: "UNREADABLE_DRAFT",
  }),
  // Mid Manager reports to the caller; Eve reports to Mid (a two-level chain).
  cand(5, "Mid Manager", {
    seniorityLevel: entry(31, "Senior"),
    review: { id: 50, status: "CALIBRATION", managerId: 7, managerName: "Me Caller", attitudeRating: null, deliveryRating: null, skillsRating: null, aptitudeRating: null, overallRating: 3 },
  }),
  cand(6, "Eve Epsilon", {
    directManagers: [{ id: 5, name: "Mid Manager" }],
    review: { id: 60, status: "PUBLISHED", managerId: 5, managerName: "Mid Manager", attitudeRating: null, deliveryRating: null, skillsRating: null, aptitudeRating: null, overallRating: 6 },
  }),
];

const POOL = [
  { id: 7, name: "Me Caller", email: "me@x.test", roles: [], deactivated: false, disabledFeatures: [], teams: [] },
  { id: 11, name: "Rita Recipient", email: "r@x.test", roles: [], deactivated: false, disabledFeatures: [], teams: [] },
];

function mockApi(opts: { items?: ShareCandidate[]; candidatesStatus?: number; periods?: unknown[] } = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/api/v1/review-periods")) {
        return Promise.resolve(jsonResponse(200, { items: opts.periods ?? PERIODS }));
      }
      if (url.includes("/api/v1/performance-reviews/share-candidates")) {
        if (opts.candidatesStatus != null) return Promise.resolve(jsonResponse(opts.candidatesStatus, { title: "x" }));
        return Promise.resolve(jsonResponse(200, { periodId: 5, items: opts.items ?? CANDIDATES }));
      }
      if (url.includes("/api/v1/dictionaries/career-paths")) {
        return Promise.resolve(jsonResponse(200, { items: [entry(11, "Software Engineer"), entry(12, "Manager")] }));
      }
      if (url.includes("/api/v1/dictionaries/seniority-levels")) {
        return Promise.resolve(jsonResponse(200, { items: [entry(31, "Senior"), entry(32, "Junior")] }));
      }
      if (url.includes("/api/v1/dictionaries/career-specializations")) {
        return Promise.resolve(jsonResponse(200, { items: [entry(21, "Backend"), entry(22, "Frontend")] }));
      }
      if (url.includes("/api/v1/dictionaries/")) {
        return Promise.resolve(jsonResponse(200, { items: [] }));
      }
      if (url.startsWith("/api/v1/users?")) {
        return Promise.resolve(jsonResponse(200, { items: POOL, page: 1, pageSize: 100, total: POOL.length }));
      }
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    }),
  );
  return calls;
}

function renderPage(route = ROUTE) {
  return renderWithProviders(
    <Routes>
      <Route path="/performance-reviews/mass-share" element={<MassSharePerformanceReviews />} />
      <Route path="/performance" element={<div>PERFORMANCE PAGE</div>} />
      <Route path="/" element={<div>HOME PAGE</div>} />
    </Routes>,
    { route },
  );
}

/** The meta strip's value cell for a label. */
function meta(label: string): HTMLElement {
  const dt = screen.getByText(label, { selector: "dt" });
  return dt.nextElementSibling as HTMLElement;
}

/** The people in the table, top to bottom (each row's checkbox name, minus the select/unavailable wording). */
function rowNames(): string[] {
  return screen
    .getAllByRole("checkbox")
    .map((c) => c.getAttribute("aria-label") ?? "")
    .filter((label) => label !== "Select all on this page")
    .map((label) => label.replace(/^Select /, "").replace(/ can't be selected:.*$/, ""));
}

async function openFilters(userEv: ReturnType<typeof userEvent.setup>) {
  await userEv.click(screen.getByRole("button", { name: /Filters/ }));
}

/** Picks an option of ONE facet: closed dropdowns keep their options in the DOM, so scope to the opened one. */
async function pickFrom(userEv: ReturnType<typeof userEvent.setup>, label: string, optionName: RegExp | string) {
  const input = screen.getByLabelText(label, { selector: "input" });
  await userEv.click(input);
  const listbox = await waitFor(() => {
    const el = document.getElementById(input.getAttribute("aria-controls") ?? "");
    if (!el) throw new Error("dropdown not open");
    return el;
  });
  await userEv.click(within(listbox).getByRole("option", { name: optionName, hidden: true }));
  await userEv.keyboard("{Escape}");
}

describe("MassSharePerformanceReviews", () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  test("a missing, malformed or unknown periodId bounces to the team's performance tab", async () => {
    mockApi();
    for (const route of [
      "/performance-reviews/mass-share",
      "/performance-reviews/mass-share?periodId=abc",
      "/performance-reviews/mass-share?periodId=-3",
    ]) {
      const view = renderPage(route);
      expect(await screen.findByText("PERFORMANCE PAGE")).toBeInTheDocument();
      view.unmount();
    }
    // A well-formed id of a period that does not exist (a stale link) bounces once periods load.
    renderPage("/performance-reviews/mass-share?periodId=99");
    expect(await screen.findByText("PERFORMANCE PAGE")).toBeInTheDocument();
  });

  test("a user with PERFORMANCE_REVIEWS disabled is sent home", () => {
    localStorage.setItem(DISABLED_KEY, JSON.stringify(["PERFORMANCE_REVIEWS"]));
    const calls = mockApi();
    renderPage();
    expect(screen.getByText("HOME PAGE")).toBeInTheDocument();
    expect(calls.some((u) => u.includes("share-candidates"))).toBe(false);
  });

  test("lists everyone with their facts; unshareable people are greyed out with the reason and cannot be selected", async () => {
    mockApi();
    renderPage();

    expect(await screen.findByText("Ann Alpha")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Share performance reviews" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to Team's performance/ })).toHaveAttribute(
      "href",
      "/performance?tab=managed",
    );
    // Shareable rows are selectable; the period label comes from the registry, not the URL.
    expect(screen.getByRole("checkbox", { name: "Select Ann Alpha" })).toBeEnabled();
    expect(await screen.findByText("January 2026 – June 2026")).toBeInTheDocument();
    // The reasons, as visible text AND as the disabled checkbox's accessible name.
    const noReview = screen.getByRole("checkbox", {
      name: "Cy Gamma can't be selected: No review in this period",
    });
    expect(noReview).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: "Dee Delta can't be selected: Draft by Olga Other" }),
    ).toBeDisabled();
    expect(screen.getAllByText("No review in this period").length).toBeGreaterThan(0);
    expect(screen.getByText("Draft by Olga Other")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    // Direct manager column reads "You" for the caller.
    expect(screen.getAllByText("You").length).toBeGreaterThan(0);
    // The strip: nothing selected, 4 of 6 people shareable.
    expect(meta("Selected")).toHaveTextContent("0");
    expect(meta("Shareable")).toHaveTextContent("4");
    expect(meta("People")).toHaveTextContent("6");
    expect(screen.getByRole("button", { name: "Share 0 reviews…" })).toBeDisabled();
  });

  test("Select all matching takes only the shareable people of the FILTERED list", async () => {
    mockApi();
    const userEv = userEvent.setup();
    renderPage();
    await screen.findByText("Ann Alpha");
    await openFilters(userEv);
    // Team AAA: everyone but Ben (BBB) — 5 people, of whom Ann, Mid and Eve are shareable.
    await pickFrom(userEv, "Teams", "AAA");
    expect(screen.queryByText("Ben Beta")).toBeNull();

    await userEv.click(screen.getByRole("button", { name: "Select all matching (3)" }));
    expect(meta("Selected")).toHaveTextContent("3");
    expect(screen.getByRole("checkbox", { name: "Select Ann Alpha" })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Cy Gamma can't be selected: No review in this period" }),
    ).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Share 3 reviews…" })).toBeEnabled();

    // Ben (outside the filter) was never taken: clearing the filter shows him unchecked.
    await userEv.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("checkbox", { name: "Select Ben Beta" })).not.toBeChecked();
    expect(meta("Selected")).toHaveTextContent("3");

    await userEv.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(meta("Selected")).toHaveTextContent("0");
    expect(screen.getByRole("button", { name: "Share 0 reviews…" })).toBeDisabled();
  });

  test("the status facet narrows the list and 'select all matching' follows it; the rest stays out", async () => {
    mockApi();
    const userEv = userEvent.setup();
    renderPage();
    await screen.findByText("Ann Alpha");
    await openFilters(userEv);

    await pickFrom(userEv, "Review status", "Published");
    // Ann + Eve are Published; the rest drop.
    expect(screen.queryByText("Ben Beta")).toBeNull();
    expect(screen.getByText("Eve Epsilon")).toBeInTheDocument();
    expect(meta("People")).toHaveTextContent("2 of 6");
    expect(screen.getByRole("button", { name: "Select all matching (2)" })).toBeInTheDocument();

    await userEv.click(screen.getByRole("button", { name: "Select all matching (2)" }));
    expect(meta("Selected")).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Share 2 reviews…" })).toBeEnabled();
  });

  test("people hidden by a filter stay selected and are counted in the note", async () => {
    mockApi();
    const userEv = userEvent.setup();
    renderPage();
    await screen.findByText("Ann Alpha");
    await userEv.click(screen.getByRole("checkbox", { name: "Select Ben Beta" }));
    await openFilters(userEv);
    await pickFrom(userEv, "Review status", "Published");

    expect(screen.queryByText("Ben Beta")).toBeNull();
    expect(meta("Selected")).toHaveTextContent("1");
    expect(screen.getByText("1 selected person is hidden by the current filters.")).toBeInTheDocument();
  });

  test("the direct-manager facet keeps the manager's whole subtree, not the manager", async () => {
    mockApi();
    const userEv = userEvent.setup();
    renderPage();
    await screen.findByText("Ann Alpha");
    await openFilters(userEv);

    await pickFrom(userEv, "Direct manager and everyone under them", "Mid Manager");
    expect(screen.getByRole("checkbox", { name: "Select Eve Epsilon" })).toBeInTheDocument();
    // The manager's own row is out (the facet is a SUBTREE filter), as is everyone outside it.
    expect(screen.queryByRole("checkbox", { name: "Select Mid Manager" })).toBeNull();
    expect(screen.queryByText("Ann Alpha")).toBeNull();
    expect(meta("People")).toHaveTextContent("1 of 6");
  });

  test("seniority 'Not set' and 'overall at least' narrow the rows", async () => {
    mockApi();
    const userEv = userEvent.setup();
    renderPage();
    await screen.findByText("Ann Alpha");
    await openFilters(userEv);

    await pickFrom(userEv, "Seniority level", "Not set");
    expect(screen.queryByText("Ann Alpha")).toBeNull();
    expect(screen.getByText("Ben Beta")).toBeInTheDocument();

    await userEv.click(screen.getByRole("button", { name: "Clear filters" }));
    await pickFrom(userEv, "Overall rating at least", /^5 — /);
    expect(screen.getByText("Ann Alpha")).toBeInTheDocument();
    expect(screen.getByText("Eve Epsilon")).toBeInTheDocument();
    expect(screen.queryByText("Ben Beta")).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Select Mid Manager" })).toBeNull();
  });

  test("the search box filters by name or email, accent-insensitively", async () => {
    mockApi({ items: [cand(1, "Żółw Żółty"), cand(2, "Ben Beta")] });
    const userEv = userEvent.setup();
    renderPage();
    await screen.findByText("Żółw Żółty");

    await userEv.type(screen.getByRole("textbox", { name: "Search people" }), "zolw");
    expect(screen.getByText("Żółw Żółty")).toBeInTheDocument();
    expect(screen.queryByText("Ben Beta")).toBeNull();
  });

  test("the header checkbox selects the shareable people of the page and toggles them off again", async () => {
    mockApi();
    const userEv = userEvent.setup();
    renderPage();
    await screen.findByText("Ann Alpha");

    await userEv.click(screen.getByRole("checkbox", { name: "Select all on this page" }));
    expect(meta("Selected")).toHaveTextContent("4");
    expect(screen.getByRole("checkbox", { name: "Select all on this page" })).toBeChecked();
    await userEv.click(screen.getByRole("checkbox", { name: "Select all on this page" }));
    expect(meta("Selected")).toHaveTextContent("0");
  });

  test("opens the share dialog with the selected count", async () => {
    mockApi();
    const userEv = userEvent.setup();
    renderPage();
    await screen.findByText("Ann Alpha");
    await userEv.click(screen.getByRole("checkbox", { name: "Select Ann Alpha" }));
    await userEv.click(screen.getByRole("checkbox", { name: "Select Ben Beta" }));
    await userEv.click(screen.getByRole("button", { name: "Share 2 reviews…" }));

    const dialog = await screen.findByRole("dialog", { name: "Share performance reviews" });
    expect(within(dialog).getByText(/You are sharing 2 performance reviews\./)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Share" })).toBeDisabled();
  });

  test("a run drops the settled people from the selection and refetches the candidates", async () => {
    const calls = mockApi();
    // The batch answers every pair CREATED.
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const base = fetchMock.getMockImplementation() as (input: string, init?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      if (String(input) === "/api/v1/shares/batch") {
        const body = JSON.parse(String(init?.body));
        const items = body.resourceIds.flatMap((r: number) =>
          body.shareeIds.map((s: number) => ({ resourceId: r, shareeId: s, status: "CREATED", shareId: r + s })),
        );
        return Promise.resolve(
          jsonResponse(200, { batchId: "b", items, created: items.length, alreadyShared: 0, forbidden: 0, notFound: 0 }),
        );
      }
      return base(input, init);
    });
    const userEv = userEvent.setup();
    renderPage();
    await screen.findByText("Ann Alpha");
    await userEv.click(screen.getByRole("checkbox", { name: "Select Ann Alpha" }));
    await userEv.click(screen.getByRole("button", { name: "Share 1 review…" }));

    const dialog = await screen.findByRole("dialog", { name: "Share performance reviews" });
    await userEv.click(within(dialog).getByRole("combobox", { name: "Share with" }));
    await userEv.click(await screen.findByRole("option", { name: /Rita Recipient/, hidden: true }));
    const before = calls.filter((u) => u.includes("share-candidates")).length;
    await userEv.click(within(dialog).getByRole("button", { name: "Share" }));

    expect(await within(dialog).findByText("New shares: 1")).toBeInTheDocument();
    await waitFor(() => expect(calls.filter((u) => u.includes("share-candidates")).length).toBeGreaterThan(before));
    await userEv.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(meta("Selected")).toHaveTextContent("0"));
  });

  test("team and specialization facets narrow the rows", async () => {
    mockApi();
    const userEv = userEvent.setup();
    renderPage();
    await screen.findByText("Ann Alpha");
    await openFilters(userEv);

    await pickFrom(userEv, "Teams", "BBB");
    expect(rowNames()).toEqual(["Ben Beta"]);
    await userEv.click(screen.getByRole("button", { name: "Clear filters" }));

    await pickFrom(userEv, "Specialty", "Backend");
    expect(rowNames()).toEqual(["Ann Alpha"]);
    expect(meta("People")).toHaveTextContent("1 of 6");
  });

  test("sorting by Overall puts unrated people last in both directions", async () => {
    mockApi();
    const userEv = userEvent.setup();
    renderPage();
    await screen.findByText("Ann Alpha");
    expect(rowNames()).toEqual([
      "Ann Alpha", "Ben Beta", "Cy Gamma", "Dee Delta", "Eve Epsilon", "Mid Manager",
    ]);

    await userEv.click(screen.getByRole("button", { name: /Overall/ }));
    expect(rowNames()).toEqual(["Mid Manager", "Ann Alpha", "Eve Epsilon", "Ben Beta", "Cy Gamma", "Dee Delta"]);
    await userEv.click(screen.getByRole("button", { name: /Overall/ }));
    expect(rowNames()).toEqual(["Eve Epsilon", "Ann Alpha", "Mid Manager", "Ben Beta", "Cy Gamma", "Dee Delta"]);
  });

  test("stale stored picks are pruned and a bad stored status or rating is rejected — nobody gets hidden", async () => {
    const store = (key: string, value: unknown) =>
      localStorage.setItem(`lettuce.viewSettings.massShare.filter.${key}`, JSON.stringify(value));
    store("teams", ["Gone team"]);
    store("managers", ["999"]);
    store("careerPath", ["404"]);
    store("careerSpecialization", ["404"]);
    store("seniorityLevel", ["404"]);
    store("status", ["BOGUS"]);
    store("minOverall", "9");
    mockApi();
    renderPage();

    await screen.findByText("Ann Alpha");
    // Dictionary picks are pruned once their options have loaded.
    await waitFor(() => expect(rowNames()).toHaveLength(6));
    expect(meta("People")).toHaveTextContent("6");
    expect(screen.queryByText(/of 6/)).toBeNull();
  });

  test("a valid stored rating is restored and applied", async () => {
    localStorage.setItem("lettuce.viewSettings.massShare.filter.minOverall", JSON.stringify("5"));
    mockApi();
    renderPage();
    await screen.findByText("Ann Alpha");
    expect(rowNames()).toEqual(["Ann Alpha", "Eve Epsilon"]);
  });

  test("with more people than a page: paging, 'select all on this page' vs 'select all matching' across pages", async () => {
    const many = Array.from({ length: 130 }, (_, i) => cand(100 + i, `Person ${String(i).padStart(3, "0")}`));
    mockApi({ items: many });
    const userEv = userEvent.setup();
    renderPage();
    await screen.findByText("Person 000");

    expect(screen.getByText("130 total")).toBeInTheDocument();
    expect(rowNames()).toHaveLength(20);
    expect(meta("People")).toHaveTextContent("130");

    // The header checkbox takes the 20 of THIS page only.
    await userEv.click(screen.getByRole("checkbox", { name: "Select all on this page" }));
    expect(meta("Selected")).toHaveTextContent("20");

    await userEv.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Person 020")).toBeInTheDocument();
    expect(screen.queryByText("Person 000")).toBeNull();
    // Page 2's header checkbox is its own: unchecked, and it adds 20 more.
    expect(screen.getByRole("checkbox", { name: "Select all on this page" })).not.toBeChecked();
    await userEv.click(screen.getByRole("checkbox", { name: "Select all on this page" }));
    expect(meta("Selected")).toHaveTextContent("40");

    // "Select all matching" reaches past the pages: all 130.
    await userEv.click(screen.getByRole("button", { name: "Select all matching (130)" }));
    expect(meta("Selected")).toHaveTextContent("130");
    expect(screen.getByRole("button", { name: "Share 130 reviews…" })).toBeEnabled();
    // The last page shows the remainder, all checked.
    await userEv.click(screen.getByRole("button", { name: "Last page" }));
    expect(await screen.findByText("Person 129")).toBeInTheDocument();
    expect(rowNames()).toHaveLength(10);
    expect(screen.getByRole("checkbox", { name: "Select Person 129" })).toBeChecked();
  });

  test("Clear selection is enabled only by selected people who can really be shared", async () => {
    mockApi();
    const userEv = userEvent.setup();
    renderPage();
    await screen.findByText("Ann Alpha");
    expect(screen.getByRole("button", { name: "Clear selection" })).toBeDisabled();
    await userEv.click(screen.getByRole("checkbox", { name: "Select Ann Alpha" }));
    expect(screen.getByRole("button", { name: "Clear selection" })).toBeEnabled();
  });

  test("a person with no one under them: the empty chain reads as such, without a table", async () => {
    mockApi({ items: [] });
    renderPage();
    expect(
      await screen.findByText("Nobody is in your reporting line, so there is nothing to share."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  test("a failed load is an error alert, never a silent blank", async () => {
    mockApi({ candidatesStatus: 500 });
    renderPage();
    expect(await screen.findByText("Couldn't load the people in your reporting line.")).toBeInTheDocument();
    expect(screen.queryByText("Ann Alpha")).toBeNull();
  });
});
