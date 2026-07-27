import { expect, login, logout, MANAGER_AAA, AAA_THREE, notificationCard, openBell, test, uniqueText } from "./helpers";
import type { Page } from "@playwright/test";

// Goals: a manager defines a goal for a direct report and walks it around the
// DRAFT <-> ACTIVE <-> CLOSED machine. Manager AAA ↔ AAA Three (the least-used seeded pair).
// Goals are new rows, so seeded accounts are never mutated; every spec deletes what it creates
// (delete is DRAFT-only, so cleanup deactivates first when needed).

// Today as the ISO YYYY-MM-DD an <input type="date"> takes (local time) — the earliest valid
// due date, so specs never race midnight.
function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Open the per-subordinate goals drill-down via the dashboard card, like a user would.
async function gotoSubordinateGoals(page: Page): Promise<void> {
  await page.goto("/?tab=subordinates");
  await page.getByRole("link", { name: "Goals for AAA Three" }).click();
  await expect(page).toHaveURL(/\/users\/\d+\/goals/);
}

// Fill the prefilled create form and Create; answer the activate prompt; land back on the list.
async function createGoal(page: Page, title: string, activate: boolean): Promise<number> {
  await page.getByRole("link", { name: "New goal" }).click();
  await expect(page).toHaveURL(/\/goals\/new/);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Target").fill("5");
  await page.getByLabel("Due date").fill(todayIso());
  const [created] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/goals") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Create", exact: true }).click(),
  ]);
  const id = (await created.json()).id as number;
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Do you want to activate the goal immediately?")).toBeVisible();
  await dialog.getByRole("button", { name: activate ? "Yes" : "No", exact: true }).click();
  await expect(page).toHaveURL(/\/users\/\d+\/goals/);
  return id;
}

// The row for a goal, located by its unique title.
function goalRow(page: Page, title: string) {
  return page.locator("tr", { hasText: title });
}

// Cleanup: bring the goal back to DRAFT if needed, then delete it from the DRAFT editor.
async function deleteGoal(page: Page, id: number): Promise<void> {
  await page.goto(`/goals/${id}/view`);
  // Wait for the document to render (Edit is a LINK; the lifecycle actions are buttons) before
  // branching on the goal's status.
  const deactivate = page.getByRole("button", { name: "Return to draft", exact: true });
  const editLink = page.getByRole("link", { name: "Edit", exact: true });
  await expect(deactivate.or(editLink).first()).toBeVisible();
  if (await deactivate.isVisible()) {
    await deactivate.click();
    await expect(page).toHaveURL(/\/goals$/); // the action navigated to the default backTo
    await page.goto(`/goals/${id}/edit`);
  } else {
    await editLink.click();
  }
  await expect(page).toHaveURL(new RegExp(`/goals/${id}/edit`));
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Delete this draft goal?")).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/api/v1/goals/${id}`) && r.request().method() === "DELETE" && r.ok(),
    ),
    dialog.getByRole("button", { name: "Delete", exact: true }).click(),
  ]);
}

test("a manager walks a goal around the whole lifecycle: draft, activate, progress, close, reopen", async ({ page }) => {
  const title = uniqueText("E2E-goal-cycle");

  await login(page, MANAGER_AAA);
  await gotoSubordinateGoals(page);
  const id = await createGoal(page, title, false); // "No" keeps the draft
  await expect(goalRow(page, title).getByText("Draft", { exact: true })).toBeVisible();

  // The DRAFT editor: Save & activate in one go (validated multi-submit).
  await goalRow(page, title).getByRole("link", { name: `Edit goal ${title}` }).click();
  await expect(page).toHaveURL(new RegExp(`/goals/${id}/edit`));
  await page.getByRole("button", { name: "Save & activate", exact: true }).click();
  // exact — getByText substring-matching would also hit the goal's own lowercase title.
  await expect(goalRow(page, title).getByText("Active", { exact: true })).toBeVisible();

  // The ACTIVE editor is the progress form: record a current value.
  await goalRow(page, title).getByRole("link", { name: `Edit goal ${title}` }).click();
  await page.getByLabel("Current").fill("3");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/users\/\d+\/goals/);
  await expect(goalRow(page, title).getByText("3", { exact: true })).toBeVisible();

  // Close from the view screen — the summary is mandatory.
  await page.goto(`/goals/${id}/view`);
  await page.getByRole("button", { name: "Close goal", exact: true }).click();
  const closeDialog = page.getByRole("dialog");
  await closeDialog.getByLabel("Summary").fill("Wrapped up in the e2e run");
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/api/v1/goals/${id}/close`) && r.request().method() === "POST" && r.ok(),
    ),
    closeDialog.getByRole("button", { name: "Close goal", exact: true }).click(),
  ]);

  // Reopen — the record (summary included) survives the round-trip.
  await page.goto(`/goals/${id}/view`);
  await expect(page.getByText("Wrapped up in the e2e run")).toBeVisible();
  await page.getByRole("button", { name: "Reopen", exact: true }).click();
  await expect(page).toHaveURL(/\/goals$/);

  // Cleanup: back to draft, delete; gone from the drill-down list.
  await deleteGoal(page, id);
  await gotoSubordinateGoals(page);
  await expect(page.getByRole("heading", { name: /Goals/ })).toBeVisible();
  await expect(goalRow(page, title)).toHaveCount(0);
});

test("activating at creation notifies the subordinate, who sees the goal read-only in My goals", async ({ page }) => {
  const title = uniqueText("E2E-goal-active");

  await login(page, MANAGER_AAA);
  await gotoSubordinateGoals(page);
  const id = await createGoal(page, title, true); // "Yes" activates on the spot
  await expect(goalRow(page, title).getByText("Active", { exact: true })).toBeVisible();

  // The subordinate: bell notification with the goal's title, and the goal in "My goals".
  await logout(page);
  await login(page, AAA_THREE);
  const dialog = await openBell(page);
  await expect(
    notificationCard(dialog, `Manager AAA activated the goal "${title}" for you`),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/goals");
  await expect(goalRow(page, title).getByText("Active", { exact: true })).toBeVisible();
  // Read-only from the subordinate's side: a View link, never Edit.
  await expect(goalRow(page, title).getByRole("link", { name: `View goal ${title}` })).toBeVisible();
  await expect(goalRow(page, title).getByRole("link", { name: `Edit goal ${title}` })).toHaveCount(0);

  // Cleanup: the manager deactivates and deletes.
  await logout(page);
  await login(page, MANAGER_AAA);
  await deleteGoal(page, id);
});
