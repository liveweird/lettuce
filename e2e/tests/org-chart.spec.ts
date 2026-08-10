import { AAA_ONE, expect, login, test } from "./helpers";

// The org chart (v1.23.0): the whole organization as a React Flow canvas — person nodes
// (clickable → user details), team nodes (clickable → roster), manages/member edges.
// Read-only: no data is created or mutated.

test("the org chart renders the seed org and drills into details and rosters", async ({ page }) => {
  await login(page, AAA_ONE);
  await page.getByRole("button", { name: "Config" }).click();
  await page.getByRole("link", { name: "Org chart" }).click();
  await expect(page).toHaveURL(/\/org$/);

  // The seed org renders: team nodes and the manager chain (CCC's manager above the members
  // who themselves manage AAA/BBB). Seeded people/teams always exist, whatever else e2e added.
  await expect(page.getByRole("button", { name: "Members of CCC" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Members of AAA" })).toBeVisible();
  await expect(page.getByRole("button", { name: "User details for Manager CCC" })).toBeVisible();
  // The caller's own node is plain — no details affordance for oneself.
  await expect(page.getByRole("button", { name: "User details for AAA One" })).toHaveCount(0);

  // People in no team (the seed Administrator) render too, under the section label, as
  // ordinary clickable nodes (v1.30.2). exact: true — dev volumes hold arbitrary E2E-* names.
  await expect(page.getByText("Not in any team", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "User details for Administrator", exact: true }),
  ).toBeVisible();

  // A person node opens the details view with the org origin, and the back link returns here.
  await page.getByRole("button", { name: "User details for Manager AAA" }).click();
  await expect(page.getByText("One of your managers")).toBeVisible();
  await page.getByRole("link", { name: /Back to Org chart/ }).click();
  await expect(page).toHaveURL(/\/org$/);

  // A team node opens that team's roster — whose back link returns to the chart, not /teams.
  await page.getByRole("button", { name: "Members of AAA" }).click();
  await expect(page.getByRole("heading", { name: "Team details" })).toBeVisible();
  await expect(page.getByText("AAA", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: /Back to Org chart/ }).click();
  await expect(page).toHaveURL(/\/org$/);
});
