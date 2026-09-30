import {
  AAA_ONE,
  clickProvideFeedback,
  expect,
  gotoUserRow,
  login,
  MANAGER_AAA,
  recordApiWrites,
  test,
} from "./helpers";

// Back / Cancel return navigation (v4.6.0): the shared person/team links carry the exact page
// they were clicked on (`back=`), the create screens' Cancel honours its own `cancel=`, and the
// team pages pass their origin along every outgoing link — so each "← Back to …" and each
// Cancel lands where the user actually came from, tab and all. Read-only: nothing is created
// or saved (the create screens are cancelled untouched), and every test asserts that no
// non-GET API request was issued — so no seed account's state is touched and no data is owned.

test("a dashboard team badge returns to the tab it was clicked on", async ({ page }) => {
  await login(page, MANAGER_AAA);
  const writes = recordApiWrites(page);
  await page.goto("/?tab=managers");

  // Manager CCC (who manages CCC, where Manager AAA is a member) is on My managers.
  await page.getByRole("link", { name: "Team details for CCC" }).first().click();
  await expect(page).toHaveURL(/\/teams\/\d+\/details\?back=/);
  await expect(page.getByRole("heading", { name: "Team details" })).toBeVisible();

  // The label follows the destination: the tab, not the Teams list the old default implied.
  await page.getByRole("link", { name: /Back to My managers/ }).click();
  await expect(page).toHaveURL(/\/\?tab=managers$/);
  expect(writes).toEqual([]);
});

test("a team opened from the org chart keeps its origin through a roster person and the per-person feedback list", async ({
  page,
}) => {
  await login(page, AAA_ONE);
  const writes = recordApiWrites(page);
  await page.goto("/org");
  await page.getByRole("button", { name: "Members of AAA", exact: true }).click();
  await expect(page).toHaveURL(/\/teams\/\d+\/details\?from=org$/);
  await expect(page.getByRole("heading", { name: "Team details" })).toBeVisible();

  // Roster person → details: Back names the roster and returns to the team WITH its origin.
  await page.getByRole("link", { name: "User details for AAA Two" }).click();
  await expect(page.getByText("One of your peers")).toBeVisible();
  await page.getByRole("link", { name: /Back to Team members/ }).click();
  await expect(page).toHaveURL(/\/teams\/\d+\/details\?from=org$/);

  // ...and the team's own back link still reaches the org chart.
  await page.getByRole("link", { name: /Back to Org chart/ }).click();
  await expect(page).toHaveURL(/\/org$/);

  // The same chain through the roster row's per-person feedback list.
  await page.getByRole("button", { name: "Members of AAA", exact: true }).click();
  await page.getByRole("button", { name: "Feedback actions for AAA Two" }).click();
  await page.getByRole("menuitem", { name: "Feedbacks with AAA Two" }).click();
  await expect(page).toHaveURL(/\/users\/\d+\/feedbacks\?/);
  await page.getByRole("link", { name: /Back to Team members/ }).click();
  await expect(page).toHaveURL(/\/teams\/\d+\/details\?from=org$/);
  await page.getByRole("link", { name: /Back to Org chart/ }).click();
  await expect(page).toHaveURL(/\/org$/);
  expect(writes).toEqual([]);
});

test("the team KPI list keeps the My teams origin of the team page it was opened from", async ({ page }) => {
  await login(page, MANAGER_AAA);
  const writes = recordApiWrites(page);
  await page.goto("/?tab=myTeams");
  await page.getByRole("link", { name: "Team details for AAA" }).click();
  await expect(page).toHaveURL(/\/teams\/\d+\/details\?from=myTeams$/);

  // Scoped to the page body: the sidebar also has a "Team KPIs" leaf.
  await page.locator("#main-content").getByRole("link", { name: "Team KPIs" }).click();
  await expect(page).toHaveURL(/\/teams\/\d+\/kpis\?from=team&back=/);
  await expect(page.getByRole("heading", { name: "Team KPIs of AAA" })).toBeVisible();

  // Back returns to the team page WITH its My teams origin — and that page still names it.
  await page.getByRole("link", { name: /Back to AAA/ }).click();
  await expect(page).toHaveURL(/\/teams\/\d+\/details\?from=myTeams$/);
  await page.getByRole("link", { name: /Back to My teams/ }).click();
  await expect(page).toHaveURL(/\/\?tab=myTeams$/);
  expect(writes).toEqual([]);
});

test("Cancel on a create screen returns to where it was opened from", async ({ page }) => {
  await login(page, MANAGER_AAA);
  const writes = recordApiWrites(page);

  // A hub header's "New goal": Save would land on Managed, Cancel returns to the Own tab.
  await page.goto("/goals?tab=own");
  await page.getByRole("link", { name: "New goal" }).click();
  await expect(page).toHaveURL(/\/goals\/new/);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/goals\?tab=own$/);

  // A Users-list "Provide feedback" returns to the Users list, not the Dashboard.
  await gotoUserRow(page, "AAA One");
  await clickProvideFeedback(page, "AAA One");
  await expect(page).toHaveURL(/\/feedback\/new\?/);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/users$/);
  expect(writes).toEqual([]);
});
