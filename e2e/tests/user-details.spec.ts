import { expect, gotoUserRow, login, MANAGER_AAA, test } from "./helpers";

// The read-only user-details view (v1.21.0): /users/:userId/details renders the person's
// dashboard card, flavor picked by the viewer's relationship to them (their manager beats
// my-direct-report beats peer), reached via the "User details" buttons on /users and on a
// team's members roster. Read-only: no data is created or mutated. Every /users click goes
// through gotoUserRow — accumulated E2E-* throwaways push seed rows off page 1 otherwise.

test("the Users list opens the details view in every relationship flavor", async ({ page }) => {
  await login(page, MANAGER_AAA);

  // One's own row never gets the button (a relationship needs someone else).
  await gotoUserRow(page, "Manager AAA");
  await expect(page.getByRole("link", { name: "User details for Manager AAA" })).toHaveCount(0);

  // Manager CCC manages team CCC, of which Manager AAA is a member → the managers-tab card.
  await gotoUserRow(page, "Manager CCC");
  await page.getByRole("link", { name: "User details for Manager CCC" }).click();
  await expect(page.getByText("One of your managers")).toBeVisible();
  await expect(page.getByText("Last 1:1")).toBeVisible();
  await expect(page.getByRole("link", { name: "Goals from Manager CCC" })).toBeVisible();

  // The back link returns to the users list (then re-filter for the next person).
  await page.getByRole("link", { name: /Back to Users/ }).click();
  await expect(page).toHaveURL(/\/users$/);

  // A direct report → the subordinates-tab card with its actions (the create flows sit in
  // the card's topic dropdowns since v1.51.0).
  await gotoUserRow(page, "AAA One");
  await page.getByRole("link", { name: "User details for AAA One" }).click();
  await expect(page.getByText("One of your subordinates")).toBeVisible();
  await page.getByRole("button", { name: "1:1 actions for AAA One" }).click();
  await expect(page.getByRole("menuitem", { name: "New 1:1 with AAA One" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Feedback actions for AAA One" }).click();
  await expect(page.getByRole("menuitem", { name: "Request feedback about AAA One" })).toBeVisible();
  await page.keyboard.press("Escape");

  // An unrelated user (team BBB) still gets a card — no relationship hint, no stats.
  await gotoUserRow(page, "BBB One");
  await page.getByRole("link", { name: "User details for BBB One" }).click();
  await expect(page.getByText("bbb-one@lettuce.local")).toBeVisible();
  await expect(page.getByText(/One of your/)).toHaveCount(0);
  await expect(page.getByText("Last 1:1")).toHaveCount(0);
  await page.getByRole("button", { name: "Feedback actions for BBB One" }).click();
  await expect(page.getByRole("menuitem", { name: "Feedbacks with BBB One" })).toBeVisible();
});

test("the teams list's manager chip opens the details view and round-trips back", async ({ page }) => {
  await login(page, MANAGER_AAA);
  await page.goto("/teams");
  // Filter to team CCC (leftover E2E-* teams may crowd page 1), whose manager is Manager CCC.
  const toggle = page.getByRole("button", { name: "Filters" });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await page.getByLabel("Name", { exact: true }).fill("CCC");
  await page.getByRole("link", { name: "User details for Manager CCC" }).click();

  // Manager CCC manages the caller's team CCC → the managers-tab card, back to /teams.
  await expect(page.getByText("One of your managers")).toBeVisible();
  await page.getByRole("link", { name: /Back to Teams/ }).click();
  await expect(page).toHaveURL(/\/teams$/);
});

test("a team roster opens the peer flavor and round-trips back to the roster", async ({ page }) => {
  await login(page, MANAGER_AAA);
  await page.goto("/teams");
  await page.getByRole("link", { name: "Team details for CCC" }).click();

  // Fellow member Manager BBB gets the button; one's own row does not.
  await expect(page.getByRole("link", { name: "User details for Manager BBB" })).toBeVisible();
  await expect(page.getByRole("link", { name: "User details for Manager AAA" })).toHaveCount(0);

  await page.getByRole("link", { name: "User details for Manager BBB" }).click();
  await expect(page.getByText("One of your peers")).toBeVisible();
  await expect(page.getByText("Feedback from me")).toBeVisible();
  await expect(page.getByText("Feedback from them")).toBeVisible();

  // The members origin returns to that team's roster, not the users list.
  await page.getByRole("link", { name: /Back to Team members/ }).click();
  await expect(page).toHaveURL(/\/teams\/\d+\/details/);
  await expect(page.getByRole("heading", { name: "Team details" })).toBeVisible();
  await expect(page.getByText("CCC", { exact: true })).toBeVisible();
});

// The /users/:id/teams membership view (previously uncovered): every authenticated user gets
// the row's "Teams" button; the page heading carries the person's name from the ?name= param
// (getUser is self-or-admin-only, so the list passes the name along), and each membership row
// links to the team-details view. Read-only against seed users — no roster is mutated.
test("the Users list's Teams button opens the read-only membership view", async ({ page }) => {
  await login(page, MANAGER_AAA);
  await gotoUserRow(page, "AAA One");
  await page.getByRole("link", { name: "Teams for AAA One" }).click();

  await expect(page).toHaveURL(/\/users\/\d+\/teams\?name=/);
  await expect(page.getByRole("heading", { name: "Teams — AAA One" })).toBeVisible();
  // AAA One is on team AAA's roster; the row links to that team's details view.
  await expect(page.getByRole("link", { name: "Team details for AAA" })).toBeVisible();
});
