import { expect, login, MANAGER_AAA, test } from "./helpers";

// The read-only user-details view (v1.21.0): /users/:userId/details renders the person's
// dashboard card, flavor picked by the viewer's relationship to them (their manager beats
// my-direct-report beats peer), reached via the "User details" buttons on /users and on a
// team's members roster. Read-only: no data is created or mutated.

test("the Users list opens the details view in every relationship flavor", async ({ page }) => {
  await login(page, MANAGER_AAA);
  await page.goto("/users");

  // Everyone gets the button — except one's own row (a relationship needs someone else).
  await expect(page.getByRole("link", { name: "User details for AAA One" })).toBeVisible();
  await expect(page.getByRole("link", { name: "User details for Manager AAA" })).toHaveCount(0);

  // Manager CCC manages team CCC, of which Manager AAA is a member → the managers-tab card.
  await page.getByRole("link", { name: "User details for Manager CCC" }).click();
  await expect(page.getByText("One of your managers")).toBeVisible();
  await expect(page.getByText("Last 1:1")).toBeVisible();
  await expect(page.getByRole("link", { name: "Goals from Manager CCC" })).toBeVisible();

  // Back to the list, then a direct report → the subordinates-tab card with its actions.
  await page.getByRole("link", { name: /Back to Users/ }).click();
  await expect(page).toHaveURL(/\/users$/);
  await page.getByRole("link", { name: "User details for AAA One" }).click();
  await expect(page.getByText("One of your subordinates")).toBeVisible();
  await expect(page.getByRole("link", { name: "New 1:1 with AAA One" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Request feedback about AAA One" })).toBeVisible();

  // An unrelated user (team BBB) still gets a card — no relationship hint, no stats.
  await page.getByRole("link", { name: /Back to Users/ }).click();
  await page.getByRole("link", { name: "User details for BBB One" }).click();
  await expect(page.getByText("bbb-one@lettuce.local")).toBeVisible();
  await expect(page.getByText(/One of your/)).toHaveCount(0);
  await expect(page.getByText("Last 1:1")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Feedbacks with BBB One" })).toBeVisible();
});

test("a team roster opens the peer flavor and round-trips back to the roster", async ({ page }) => {
  await login(page, MANAGER_AAA);
  await page.goto("/teams");
  await page.getByRole("link", { name: "Members of CCC" }).click();

  // Fellow member Manager BBB gets the button; one's own row does not.
  await expect(page.getByRole("link", { name: "User details for Manager BBB" })).toBeVisible();
  await expect(page.getByRole("link", { name: "User details for Manager AAA" })).toHaveCount(0);

  await page.getByRole("link", { name: "User details for Manager BBB" }).click();
  await expect(page.getByText("One of your peers")).toBeVisible();
  await expect(page.getByText("Feedback from me")).toBeVisible();
  await expect(page.getByText("Feedback from them")).toBeVisible();

  // The members origin returns to that team's roster, not the users list.
  await page.getByRole("link", { name: /Back to Team members/ }).click();
  await expect(page).toHaveURL(/\/teams\/\d+\/members/);
  await expect(page.getByRole("heading", { name: "Members — CCC" })).toBeVisible();
});
