import { expect, login, logout, MANAGER_AAA, MANAGER_CCC, AAA_THREE, notificationCard, openBell, test, uniqueText } from "./helpers";
import type { Page } from "@playwright/test";

// Goals: a manager defines a goal for a direct report and walks it around the
// DRAFT <-> ACTIVE <-> ARCHIVED machine. Manager AAA ↔ AAA Three (the least-used seeded pair).
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
    // Return-to-draft asks first (v2.8.0) — confirm inside the dialog.
    const confirm = page.getByRole("dialog");
    await expect(confirm.getByText("Return this goal to draft?")).toBeVisible();
    await confirm.getByRole("button", { name: "Return to draft", exact: true }).click();
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

test("a manager walks a goal around the whole lifecycle: draft, activate, progress, archive, reopen", async ({ page }) => {
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

  // The ACTIVE row leads to the Update screen (v2.8.0): record a current value with a comment.
  await goalRow(page, title).getByRole("link", { name: `Update goal ${title}` }).click();
  await expect(page).toHaveURL(new RegExp(`/goals/${id}/edit`));
  await page.getByLabel("Current").fill("3");
  await page.getByLabel("Comment (optional)").fill("Three of five shipped");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/users\/\d+\/goals/);
  await expect(goalRow(page, title).getByText("3", { exact: true })).toBeVisible();

  // Archive from the row's Lifecycle ▾ menu — the summary is mandatory.
  await goalRow(page, title).getByRole("button", { name: `Lifecycle actions for goal ${title}` }).click();
  await page.getByRole("menuitem", { name: "Archive goal" }).click();
  const archiveDialog = page.getByRole("dialog");
  await archiveDialog.getByLabel("Summary").fill("Wrapped up in the e2e run");
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/api/v1/goals/${id}/archive`) && r.request().method() === "POST" && r.ok(),
    ),
    archiveDialog.getByRole("button", { name: "Archive goal", exact: true }).click(),
  ]);
  await expect(goalRow(page, title).getByText("Archived", { exact: true })).toBeVisible();

  // The view: the record (summary included) survives, and the History tab carries the
  // progress-update comment.
  await page.goto(`/goals/${id}/view`);
  await expect(page.getByText("Wrapped up in the e2e run")).toBeVisible();
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByText("Three of five shipped")).toBeVisible();

  // Reopen from the view screen (the footer actions sit outside the tabs).
  await page.getByRole("button", { name: "Reopen", exact: true }).click();
  await expect(page).toHaveURL(/\/goals$/);

  // Cleanup: back to draft, delete; gone from the drill-down list.
  await deleteGoal(page, id);
  await gotoSubordinateGoals(page);
  await expect(page.getByRole("heading", { name: /Goals/ })).toBeVisible();
  await expect(goalRow(page, title)).toHaveCount(0);
});

test("a PLAN goal: milestones defined in draft, ticked on the update screen, struck through when done", async ({ page }) => {
  const title = uniqueText("E2E-goal-plan");

  await login(page, MANAGER_AAA);
  await gotoSubordinateGoals(page);

  // Create a PLAN goal with two milestones (the createGoal helper is NUMBER-shaped).
  await page.getByRole("link", { name: "New goal" }).click();
  await expect(page).toHaveURL(/\/goals\/new/);
  await page.getByLabel("Title").fill(title);
  // exact — the description editor's toolbar has a "Block type" combobox that substring-matches.
  await page.getByRole("combobox", { name: "Type", exact: true }).click();
  await page.getByRole("option", { name: "Plan (milestones)" }).click();
  await expect(page.getByLabel("Target")).toHaveCount(0); // PLAN has no target
  // textbox role + exact — getByLabel would substring-match the rows' move/remove buttons.
  await page.getByRole("button", { name: "Add milestone" }).click();
  await page.getByRole("textbox", { name: "Milestone 1", exact: true }).fill("Pass the exam");
  await page.getByRole("button", { name: "Add milestone" }).click();
  await page.getByRole("textbox", { name: "Milestone 2", exact: true }).fill("File the certificate");
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
  await dialog.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(page).toHaveURL(/\/users\/\d+\/goals/);
  // The list's Current cell is the milestone tally.
  await expect(goalRow(page, title).getByText("0 / 2", { exact: true })).toBeVisible();

  // Tick the first milestone on the Update screen, with a comment.
  await goalRow(page, title).getByRole("link", { name: `Update goal ${title}` }).click();
  await expect(page).toHaveURL(new RegExp(`/goals/${id}/edit`));
  await page.getByLabel("Pass the exam").check();
  await page.getByLabel("Comment (optional)").fill("Exam passed on the first try");
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/api/v1/goals/${id}/progress`) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
  await expect(page).toHaveURL(/\/users\/\d+\/goals/);
  await expect(goalRow(page, title).getByText("1 / 2", { exact: true })).toBeVisible();

  // The view: the done milestone is visibly settled (struck through), the open one is not,
  // and the History tab carries the tick event with its comment.
  await page.goto(`/goals/${id}/view`);
  await expect(page.getByText("Pass the exam")).toHaveCSS("text-decoration-line", "line-through");
  await expect(page.getByText("File the certificate")).not.toHaveCSS(
    "text-decoration-line",
    "line-through",
  );
  await expect(page.getByText("1 of 2 done")).toBeVisible();
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByText("Milestone 1 marked as done.")).toBeVisible();
  await expect(page.getByText("Exam passed on the first try")).toBeVisible();

  // Cleanup: back to draft, delete.
  await deleteGoal(page, id);
});

test("the Goals-I've-set tab: Reports widens from own goals to goals set down the chain", async ({ page }) => {
  const title = uniqueText("E2E-goal-chain");

  // Manager AAA activates a goal for AAA Three — a chain goal from Manager CCC's viewpoint
  // (Manager AAA is a member of team CCC, which Manager CCC manages).
  await login(page, MANAGER_AAA);
  await gotoSubordinateGoals(page);
  const id = await createGoal(page, title, true);

  await logout(page);
  await login(page, MANAGER_CCC);
  await page.goto("/goals?tab=managed");
  await expect(page.getByRole("tab", { name: "Goals I've set" })).toBeVisible();
  // Scope the walk to the unique title (a shared database may hold other goals), and let the
  // filtered response land before asserting absence — direct scope must not leak the chain goal.
  await page.getByRole("button", { name: "Filters" }).click();
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("title=") && r.ok()),
    page.getByLabel("Title").fill(title),
  ]);
  await expect(goalRow(page, title)).toHaveCount(0);

  // Widen Reports to the whole chain: Manager AAA's active goal appears, read-only.
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("includeIndirect=true") && r.ok()),
    (async () => {
      await page.getByRole("combobox", { name: "Reports" }).click();
      await page.getByRole("option", { name: "All reports (including indirect)" }).click();
    })(),
  ]);
  await expect(goalRow(page, title).getByText("Active", { exact: true })).toBeVisible();
  // A chain manager is not a party: read-only — no Edit, no Update, no lifecycle menu.
  await expect(goalRow(page, title).getByRole("link", { name: `View goal ${title}` })).toBeVisible();
  await expect(goalRow(page, title).getByRole("link", { name: `Edit goal ${title}` })).toHaveCount(0);
  await expect(goalRow(page, title).getByRole("link", { name: `Update goal ${title}` })).toHaveCount(0);
  await expect(
    goalRow(page, title).getByRole("button", { name: `Lifecycle actions for goal ${title}` }),
  ).toHaveCount(0);

  // Cleanup by the goal's own manager.
  await logout(page);
  await login(page, MANAGER_AAA);
  await deleteGoal(page, id);
});

test("activating at creation notifies the subordinate, who updates progress with a comment that notifies the manager", async ({ page }) => {
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
  // The subordinate updates progress (v2.8.0) but never drives the lifecycle.
  await expect(
    goalRow(page, title).getByRole("button", { name: `Lifecycle actions for goal ${title}` }),
  ).toHaveCount(0);
  await goalRow(page, title).getByRole("link", { name: `Update goal ${title}` }).click();
  await expect(page).toHaveURL(new RegExp(`/goals/${id}/edit`));
  // A comment-only update: the value stays put, the context lands in the history.
  await page.getByLabel("Comment (optional)").fill("No movement yet — kickoff next week");
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/api/v1/goals/${id}/progress`) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
  await expect(page).toHaveURL(/\/goals$/);

  // The manager: the counterparty notification, and the comment in the goal's history.
  await logout(page);
  await login(page, MANAGER_AAA);
  const managerBell = await openBell(page);
  await expect(
    notificationCard(managerBell, `AAA Three updated the progress of the goal "${title}"`),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto(`/goals/${id}/view`);
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByText("No movement yet — kickoff next week")).toBeVisible();

  // Cleanup: the manager deactivates and deletes.
  await deleteGoal(page, id);
});
