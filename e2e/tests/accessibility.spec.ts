// Axe accessibility smoke: WCAG 2.0/2.1 A+AA scans over the login screen plus the admin's
// read-only views of every nav area. Strictly read-only (no created state), so it shares the
// chromium phase safely — that includes the /alerts and /pulse MANAGEMENT LISTS (reading them
// mutates nothing the later alerts/pulse phases own; those phases' interactive journeys stay
// unscanned).
import AxeBuilder from "@axe-core/playwright";
import { ADMIN, expect, login, test } from "./helpers";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

// No waived rules since v3.3.0: the theme-wide colour pass (themeVariables.ts) brought every
// text/badge/link colour to the 4.5:1 AA ratio in both schemes, so color-contrast runs
// un-waived — a regression here is a token bug, never a reason to re-waive the rule.

async function scan(page: Parameters<typeof login>[0]): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  // Keep the assert readable on failure: one line per violation with the offending nodes.
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(" ")),
  }));
  expect(summary).toEqual([]);
}

test("login screen has no WCAG A/AA violations", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await scan(page);
});

// One test per page keeps the report line-per-page; the shared admin session is re-minted
// per test because the serial unit is the file, not a shared context.
const AUTHED_PAGES: { path: string; heading: string }[] = [
  { path: "/", heading: "Dashboard" },
  { path: "/users", heading: "Users" },
  { path: "/users/new", heading: "New user" },
  { path: "/teams", heading: "Teams" },
  { path: "/feedback", heading: "Feedback" },
  { path: "/kudos", heading: "Kudos" },
  { path: "/goals", heading: "Goals" },
  { path: "/impact-log", heading: "Impact log" },
  { path: "/one-on-ones", heading: "1:1 meetings" },
  { path: "/performance", heading: "Performance" },
  { path: "/career", heading: "Career" },
  { path: "/days-off", heading: "Days off" },
  { path: "/pulse", heading: "Pulse surveys" },
  { path: "/org", heading: "Org chart" },
  { path: "/templates", heading: "Feedback templates" },
  { path: "/dictionaries/career-paths", heading: "Career paths" },
  { path: "/alerts", heading: "Alerts" },
  { path: "/changelog", heading: "Changelog" },
  // The newer form screens (2026-08 audit round): the kudos + picker-mode feedback creates,
  // the days-off request form, and the admin feature-flags screen.
  { path: "/kudos/new", heading: "New kudo" },
  { path: "/feedback/new", heading: "New feedback" },
  { path: "/impact-log/new", heading: "New journal entry" },
  { path: "/succession", heading: "Succession plans" },
  { path: "/succession/new", heading: "New succession plan" },
  { path: "/days-off/new", heading: "New days-off request" },
  { path: "/feature-flags", heading: "Feature flags" },
  { path: "/integration-clients", heading: "Integration clients" },
  // The v3.2.0 paid pool kinds registry (Config → Paid-leave pools).
  { path: "/days-off-pools", heading: "Paid-leave pools" },
];

for (const { path, heading } of AUTHED_PAGES) {
  test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
    await login(page, ADMIN);
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await scan(page);
  });
}

// The two chrome states the page list cannot reach (v3.3.0): the open notifications panel
// and the collapsed icon rail (icon-only links, groups as menus).
test("the open notifications panel has no WCAG A/AA violations", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Notifications" })).toBeVisible();
  // Let the panel's enter transition settle — axe would otherwise measure the mid-fade opacity.
  await page.waitForTimeout(500);
  await scan(page);
});

test("the collapsed icon rail has no WCAG A/AA violations", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  await page.getByRole("button", { name: "Show or hide the navigation" }).click();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await scan(page);
});
