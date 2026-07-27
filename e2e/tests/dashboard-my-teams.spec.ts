import { AAA_ONE, expect, login, MANAGER_AAA, test } from "./helpers";

// The Dashboard "My teams" tab (v1.20.0): the teams the caller manages, each opening the
// team-scoped subordinates view (/teams/:id/subordinates) — the My-subordinates card grid
// pinned to one team, with the drill-downs round-tripping back to it. Read-only: no data is
// created or mutated, so seeded accounts are untouched.

test("a manager walks My teams into the team view and a drill-down round-trips back", async ({ page }) => {
  await login(page, MANAGER_AAA);
  await page.goto("/?tab=myTeams");

  // Manager AAA manages exactly team AAA (they are a mere member of CCC, which must not show).
  await expect(page.getByRole("link", { name: "Members of AAA" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Members of CCC" })).toHaveCount(0);

  // The Members button opens the team-scoped subordinates view, not the /teams roster.
  await page.getByRole("link", { name: "Members of AAA" }).click();
  await expect(page).toHaveURL(/\/teams\/\d+\/subordinates/);
  await expect(page.getByRole("heading", { name: "AAA", exact: true })).toBeVisible();

  // The same person cards as My subordinates: stats block + the direct-report actions.
  await expect(page.getByText("AAA Three")).toBeVisible();
  await expect(page.getByText("Last 1:1").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "New 1:1 with AAA Three" })).toBeVisible();

  // Full back-link fidelity: the Goals drill-down carries the team origin and returns here.
  await page.getByRole("link", { name: "Goals for AAA Three" }).click();
  await expect(page).toHaveURL(/\/users\/\d+\/goals\?/);
  await page.getByRole("link", { name: /Back to Team subordinates/ }).click();
  await expect(page).toHaveURL(/\/teams\/\d+\/subordinates/);
  await expect(page.getByRole("heading", { name: "AAA", exact: true })).toBeVisible();

  // And the tab's own back anchor returns to the Dashboard tab.
  await page.getByRole("link", { name: /Back to My teams/ }).click();
  await expect(page).toHaveURL(/\/\?tab=myTeams/);
});

test("a non-manager sees the My teams empty state", async ({ page }) => {
  await login(page, AAA_ONE);
  await page.goto("/?tab=myTeams");

  await expect(page.getByText("No managed teams")).toBeVisible();
});
