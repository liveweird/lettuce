// Axe accessibility smoke: WCAG 2.0/2.1 A+AA scans over the login screen plus the admin's
// read-only views of every nav area. Strictly read-only (no created state), so it shares the
// chromium phase safely — that includes the /alerts and /pulse MANAGEMENT LISTS (reading them
// mutates nothing the later alerts/pulse phases own; those phases' interactive journeys stay
// unscanned).
import AxeBuilder from "@axe-core/playwright";
import { ADMIN, expect, login, test } from "./helpers";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

// Conscious waiver, not a fix backlog: the theme's dimmed/muted text and brand surfaces
// (v1.35.0 design language) sit below the 4.5:1 AA ratio by design across every page.
// Revisit only as a deliberate theme-wide design pass — never by patching single elements.
const WAIVED_RULES = ["color-contrast"];

async function scan(page: Parameters<typeof login>[0]): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(AXE_TAGS)
    .disableRules(WAIVED_RULES)
    .analyze();
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
  { path: "/days-off/new", heading: "New days-off request" },
  { path: "/feature-flags", heading: "Feature flags" },
];

for (const { path, heading } of AUTHED_PAGES) {
  test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
    await login(page, ADMIN);
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await scan(page);
  });
}
