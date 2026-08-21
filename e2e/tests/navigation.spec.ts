import { expect, login, test, AAA_ONE, MANAGER_AAA } from "./helpers";

// Shell-level navigation contracts (2026-08 audit round): the in-shell 404 catch-all
// (v2.22.0 — previously unit-tested only), the two legacy performance redirects, and the
// dashboard Peers tab — the one dashboard tab no other spec ever renders. Read-only:
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
