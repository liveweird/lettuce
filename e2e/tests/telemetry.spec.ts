// The ADMIN telemetry panel (web/src/components/TelemetryPanel.tsx): opened from the user menu, it shows Lettuce's own memory,
// the database section (the process's connection pool against its maximum, the database's size and the row counts), remembers
// that it is open across a reload, and never appears for a regular user. The sampler's first tick comes seconds after the app
// starts, so every test that reads figures first waits (through the API, bounded) until a sample and a database measurement exist.
// Read-only: owns no server-side state. The panel's open flag, expanded sections and range are device-level localStorage (a
// fresh browser context per test).
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { AAA_ONE, ADMIN, expect, login, openUserMenu, test, userMenu } from "./helpers";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Waits until the most recently started live (non-stale) process has a sample and the database has been measured (the panel would
 * otherwise say "no sample yet" for up to a minute), and returns that process's instance name. A stack rebuilt within the last
 * hour still lists the previous container's process - live for three sample intervals after it stopped, stale after - so the
 * panel can hold two Memory tables: the locators are scoped to the newest one by name. The poll is slow on purpose: the read API
 * shares a per-user budget of 30 requests a minute with the panel itself.
 */
async function awaitFirstSamples(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem("lettuce.auth.token"));
  expect(token !== null, "the admin login must provide a token for the readiness poll").toBe(true);
  let instance = "";
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/v1/telemetry/current", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok()) return `status ${res.status()}`;
        const body = (await res.json()) as {
          processes: { instance: string; startedAt: number; stale: boolean; sampledAt: number | null }[];
          database: unknown;
        };
        const newest = body.processes.filter((p) => !p.stale).sort((a, b) => b.startedAt - a.startedAt)[0];
        const ready = newest !== undefined && newest.sampledAt !== null && body.database !== null;
        if (ready) instance = newest.instance;
        return ready ? "ready" : "waiting";
      },
      { message: "the sampler's first sample of the newest live process and a database measurement", timeout: 90_000, intervals: [3_000, 5_000] },
    )
    .toBe("ready");
  return instance;
}

// The readiness poll may wait up to 90 s on a stack that has only just started, beyond the suite's 60 s default.
test.describe.configure({ timeout: 150_000 });

async function openPanelFromMenu(page: Page) {
  await openUserMenu(page);
  await page.getByRole("menuitem", { name: "Telemetry panel" }).click();
  const panel = page.getByRole("complementary", { name: "Telemetry" });
  await expect(panel).toBeVisible();
  return panel;
}

test("an admin opens the telemetry panel from the user menu and reads the Memory section", async ({ page }) => {
  await login(page, ADMIN);
  const instance = await awaitFirstSamples(page);
  const panel = await openPanelFromMenu(page);
  await expect(panel.getByRole("heading", { level: 2, name: "Telemetry" })).toBeVisible();
  // Memory is open by default. The limit depends on where the stack runs (a container limit, or none outside a cgroup), so the
  // assertion accepts either; the heap always has a figure.
  await expect(panel.getByRole("button", { name: "Memory" })).toHaveAttribute("aria-expanded", "true");
  const table = panel.getByRole("table", { name: `Memory of ${instance}`, exact: true });
  await expect(table).toBeVisible();
  await expect(table.getByRole("row", { name: /^Container limit/ })).toContainText(/No limit|\d (MB|GB)/);
  await expect(table.getByRole("row", { name: /^Heap used/ })).toContainText(/\d (KB|MB|GB)/);
  // The user menu item shows the toggle is on.
  await openUserMenu(page);
  await expect(page.getByRole("menuitem", { name: "Telemetry panel" })).toHaveAttribute("aria-current", "true");
});

test("the Database section shows the pool against its maximum, the database size and the user row count", async ({ page }) => {
  await login(page, ADMIN);
  const instance = await awaitFirstSamples(page);
  const panel = await openPanelFromMenu(page);

  await panel.getByRole("button", { name: "Database" }).click();
  const pool = panel.getByRole("table", { name: `Database connections of ${instance}`, exact: true });
  await expect(pool.getByRole("row", { name: /^Connections in use/ })).toContainText(/\d of 20/);
  const sizes = panel.getByRole("table", { name: "Database size per table group" });
  await expect(sizes.getByRole("row", { name: /^Database/ })).toContainText(/\d (KB|MB|GB)/);
  await expect(sizes.getByRole("row", { name: /^People and access/ })).toBeVisible();
  const rows = panel.getByRole("table", { name: "Rows per table" });
  await expect(rows.getByRole("row", { name: /^Users/ })).toContainText(/\d/);
});

test("the open telemetry panel survives a reload and closes with its own button", async ({ page }) => {
  await login(page, ADMIN);
  const panel = await openPanelFromMenu(page);
  await panel.getByRole("button", { name: "Database" }).click();
  await page.reload();
  const reopened = page.getByRole("complementary", { name: "Telemetry" });
  await expect(reopened).toBeVisible();
  // The expanded sections are remembered too.
  await expect(reopened.getByRole("button", { name: "Database" })).toHaveAttribute("aria-expanded", "true");

  await reopened.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Telemetry" })).toHaveCount(0);
  await page.reload();
  await expect(userMenu(page)).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Telemetry" })).toHaveCount(0);
});

test("a regular user has no telemetry item in the user menu", async ({ page }) => {
  // A seeded regular user (the session is API-minted, nothing is created or changed).
  await login(page, AAA_ONE);
  await openUserMenu(page);
  await expect(page.getByRole("menuitem", { name: "Change password" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Telemetry panel" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  // Even a stored "open" flag shows a regular user nothing.
  await page.evaluate(() => localStorage.setItem("lettuce.viewSettings.telemetry.panelOpen", "true"));
  await page.reload();
  await expect(userMenu(page)).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Telemetry" })).toHaveCount(0);
});

test("the open telemetry panel has no WCAG A/AA violations", async ({ page }) => {
  await login(page, ADMIN);
  const instance = await awaitFirstSamples(page);
  const panel = await openPanelFromMenu(page);
  for (const section of ["Database", "Requests", "JVM"]) {
    await panel.getByRole("button", { name: section }).click();
  }
  await expect(panel.getByRole("table", { name: `Memory of ${instance}`, exact: true })).toBeVisible();
  await expect(panel.getByRole("group", { name: "Trend: Memory" })).toBeVisible();
  await expect(panel.getByRole("table", { name: "Database size per table group" })).toBeVisible();
  // The panel is the shell's aside, outside <main>: the scan includes both. Every WCAG A/AA rule runs un-waived, like the
  // accessibility spec's (color-contrast included).
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).include("main").include("aside").analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});
