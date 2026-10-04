import type { Page } from "@playwright/test";
import { definePerfScreen, type Interaction, type PerfCase } from "./harness";

// Performance -> Team's performance (web/src/pages/Performance.tsx + ReviewsDashboard.tsx): the suspect screen. The
// API chain it fires is in perf/k6/lib/screens.js (probe, periods, 3 dictionaries, the members roster listAll, the reviews
// listAll — the two listAll loops run page after page); the personas mirror k6's reviews-team-view matrix. An IC never
// sees the tab (showManagedTab = isManager || auditor), so there is no IC case.
//
// Stored view state is seeded per case (the browser would remember it): `dashboardReviews.filter.reportsScope` is the
// "Reports" scope — direct (default) / all; the HR auditor who manages nobody is forced to the auditor scope by the page.
const PERIODS = /\/api\/v1\/review-periods/;
const MEMBERS = /\/api\/v1\/teams\/members\?/;
const USERS = /\/api\/v1\/users\?/;
const REVIEWS = /\/api\/v1\/performance-reviews\?/;
const TABLE = '[data-tour="performance-dashboard"]';
const ROW = `${TABLE} [role="table"] tbody tr`;

const sortByName: Interaction = {
  name: "sort-name",
  run: (page: Page) => page.locator(`${TABLE} thead`).getByRole("button", { name: "Team member" }).click(),
};

// Client-side paging over the joined rows (no request): skipped when the roster fits one page.
const nextPage: Interaction = {
  name: "next-page",
  run: async (page: Page) => {
    const next = page.getByRole("button", { name: "Next page" });
    if ((await next.count()) === 0 || !(await next.isEnabled())) return false;
    await next.click();
    return true;
  },
};

// The lazily loaded recharts chunk + the per-category distribution charts over the whole filtered roster.
const distribution: Interaction = {
  name: "distribution",
  run: (page: Page) => page.getByText("Distribution", { exact: true }).click(),
};

const quadrants: Interaction = {
  name: "quadrants",
  run: (page: Page) => page.getByText("Quadrants", { exact: true }).click(),
};

// direct -> all reports: a fresh roster listAll + reviews refetch (the `includeIndirect` request keys change).
const widenScope: Interaction = {
  name: "scope-all",
  prepare: async (page: Page) => {
    const toggle = page.getByRole("button", { name: /^Filters/ });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await page.getByRole("combobox", { name: "Reports" }).click();
  },
  run: (page: Page) => page.getByRole("option", { name: "All reports (including indirect)" }).click(),
  expectApi: [MEMBERS],
};

const managed = (scope: "direct" | "all"): Pick<PerfCase, "path" | "expectApi" | "ready" | "settings"> => ({
  path: "/performance?tab=managed",
  settings: { "dashboardReviews.filter.reportsScope": scope },
  expectApi: [PERIODS, MEMBERS, REVIEWS],
  ready: ROW,
});

definePerfScreen("reviews-team-view", [
  // The CEO: ~510 transitive reports. First load at the stored default (direct reports), then widen to all.
  { persona: "ceo", label: "ceo-direct", ...managed("direct"), interactions: [sortByName, nextPage, widenScope, sortByName, nextPage, distribution, quadrants] },
  { persona: "ceo", label: "ceo-all", ...managed("all"), interactions: [sortByName, nextPage, distribution, quadrants] },
  { persona: "director", label: "director-all", ...managed("all"), interactions: [sortByName, nextPage, distribution, quadrants] },
  { persona: "lead", label: "lead", ...managed("direct"), interactions: [sortByName, nextPage, distribution, quadrants] },
  // HR auditor, no team: the org-wide users list + view=all reviews (the page forces the auditor scope).
  {
    persona: "hr",
    label: "hr",
    path: "/performance?tab=managed",
    expectApi: [PERIODS, USERS, REVIEWS],
    ready: ROW,
    interactions: [sortByName, nextPage, distribution, quadrants],
  },
]);
