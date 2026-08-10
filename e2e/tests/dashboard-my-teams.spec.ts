import { AAA_ONE, expect, login, MANAGER_AAA, test } from "./helpers";

// The Dashboard "My teams" tab (v1.20.0, reshaped v2.5.5): the teams the caller manages —
// the team name opens the adaptive team-details page, where a MANAGER lands on the
// My-subordinates card grid pinned to that team, drill-downs round-tripping back to it.
// Read-only: no data is created or mutated, so seeded accounts are untouched.

test("a manager walks My teams into the team view and a drill-down round-trips back", async ({ page }) => {
  await login(page, MANAGER_AAA);
  await page.goto("/?tab=myTeams");

  // Manager AAA manages exactly team AAA (they are a mere member of CCC, which must not show).
  await expect(page.getByRole("link", { name: "Team details for AAA" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Team details for CCC" })).toHaveCount(0);

  // The team NAME opens the adaptive team-details page — a manager lands on their grid.
  await page.getByRole("link", { name: "Team details for AAA" }).click();
  await expect(page).toHaveURL(/\/teams\/\d+\/details\?from=myTeams/);
  await expect(page.getByRole("heading", { name: "Team details" })).toBeVisible();
  await expect(page.getByText("AAA", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Subordinates" })).toBeVisible();

  // The same person cards as My subordinates: stats block + the direct-report actions
  // (New 1:1 sits in the card's 1:1 dropdown since v1.51.0).
  await expect(page.getByText("AAA Three")).toBeVisible();
  await expect(page.getByText("Last 1:1").first()).toBeVisible();
  await page.getByRole("button", { name: "1:1 actions for AAA Three" }).click();
  await expect(page.getByRole("menuitem", { name: "New 1:1 with AAA Three" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Full back-link fidelity: the Goals drill-down carries the team origin and returns here.
  await page.getByRole("link", { name: "Goals for AAA Three" }).click();
  await expect(page).toHaveURL(/\/users\/\d+\/goals\?/);
  await page.getByRole("link", { name: /Back to Team subordinates/ }).click();
  await expect(page).toHaveURL(/\/teams\/\d+\/details/);
  await expect(page.getByRole("heading", { name: "Subordinates" })).toBeVisible();

  // And the tab's own back anchor returns to the Dashboard tab.
  await page.getByRole("link", { name: /Back to My teams/ }).click();
  await expect(page).toHaveURL(/\/\?tab=myTeams/);
});

test("a non-manager sees the My teams empty state", async ({ page }) => {
  await login(page, AAA_ONE);
  await page.goto("/?tab=myTeams");

  await expect(page.getByText("No managed teams")).toBeVisible();
});
