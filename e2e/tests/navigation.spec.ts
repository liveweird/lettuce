import { expect, login, test, AAA_ONE, MANAGER_AAA } from "./helpers";

// Shell-level navigation contracts (2026-08 audit round): the in-shell 404 catch-all
// (v2.22.0 — previously unit-tested only), the two legacy performance redirects, and the
// dashboard Peers tab — the one dashboard tab no other spec ever renders — plus (v4.21.0) the
// page title + heading focus after a keyboard navigation and a matrix table's pinned person
// column (geometry happy-dom cannot prove). Read-only:
// this spec owns no server-side state.

test("an unknown URL renders the in-shell 404 page and its dashboard link recovers", async ({ page }) => {
  await login(page, AAA_ONE);
  await page.goto("/definitely-not-a-page");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  // Inside the shell — the navbar survived (the catch-all is a routed page, not a crash).
  // exact: getByRole name-matches substrings, and "Back to dashboard" is on the page too.
  await expect(page.getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("the legacy performance URLs redirect to the Performance page", async ({ page }) => {
  await login(page, MANAGER_AAA);
  // The pre-v1.45 bookmark target.
  await page.goto("/my-performance");
  await expect(page).toHaveURL(/\/performance/);
  await expect(page.getByRole("heading", { name: "Performance" })).toBeVisible();
  // The pre-v1.45 dashboard-tab deep link (notification landings) → the managed tab.
  await page.goto("/?tab=reviews");
  await expect(page).toHaveURL(/\/performance\?tab=managed/);
  await expect(page.getByRole("heading", { name: "Performance" })).toBeVisible();
});

test("the dashboard Peers tab shows teammates as cards with both feedback directions", async ({ page }) => {
  await login(page, AAA_ONE);
  await page.goto("/?tab=peers");
  // AAA One's teammates on team AAA render as person cards carrying the peer stats
  // variant — both feedback directions, no 1:1 stat (that is manager/subordinate-only).
  await expect(page.getByText("AAA Two", { exact: true })).toBeVisible();
  await expect(page.getByText("AAA Three", { exact: true })).toBeVisible();
  await expect(page.getByText("Feedback from me").first()).toBeVisible();
  await expect(page.getByText("Feedback from them").first()).toBeVisible();
});

test("a keyboard navigation names the page in the tab title and moves focus to its heading", async ({ page }) => {
  await login(page, AAA_ONE);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(page).toHaveTitle("Dashboard · Lettuce");
  // One h1 per page (v4.21.0): the page title, nothing else.
  await expect(page.locator("h1")).toHaveCount(1);
  const goals = page.getByRole("navigation").getByRole("link", { name: "Goals", exact: true }).first();
  await goals.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/goals/);
  const heading = page.getByRole("heading", { level: 1, name: "Goals" });
  await expect(heading).toBeFocused();
  await expect(page).toHaveTitle("Goals · Lettuce");
});

test("a wide table keeps the person column pinned while it scrolls sideways", async ({ page }) => {
  // Narrow enough that the mass-share matrix overflows its scroll region.
  await page.setViewportSize({ width: 1000, height: 800 });
  await login(page, MANAGER_AAA);
  await page.goto("/days-off/mass-share");
  await expect(page.getByRole("heading", { level: 1, name: "Share days-off calendars" })).toBeVisible();
  const region = page.getByRole("region").filter({ has: page.getByRole("table") }).first();
  const person = region.getByRole("link", { name: "User details for AAA One", exact: true });
  await expect(person).toBeVisible();
  const overflow = await region.evaluate((e) => e.scrollWidth - e.clientWidth);
  expect(overflow).toBeGreaterThan(0);
  await region.evaluate((e) => {
    e.scrollLeft = e.scrollWidth;
  });
  // The person cell stays inside the region's visible box, at its start edge.
  const regionBox = await region.boundingBox();
  const personBox = await person.boundingBox();
  expect(regionBox && personBox).toBeTruthy();
  expect(personBox!.x).toBeGreaterThanOrEqual(regionBox!.x);
  expect(personBox!.x + personBox!.width).toBeLessThanOrEqual(regionBox!.x + regionBox!.width);
  expect(personBox!.x - regionBox!.x).toBeLessThan(200);
});
