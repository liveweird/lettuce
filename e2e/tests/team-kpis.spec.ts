import { AAA_ONE, expect, login, logout, MANAGER_AAA, notificationCard, openBell, test, uniqueText } from "./helpers";
import type { Page } from "@playwright/test";

// Team KPIs: a manager defines a KPI for a team they manage and walks it around the
// DRAFT <-> ACTIVE <-> CLOSED machine; members see it once active. Manager AAA ↔ team AAA
// (members aaa-one/two/three). KPIs are new rows, so seeded accounts are never mutated; every
// spec deletes what it creates (delete is DRAFT-only, so cleanup deactivates first when needed).

// Open the per-team KPI drill-down via the dashboard My-teams button, like a manager would.
async function gotoTeamKpis(page: Page): Promise<void> {
  await page.goto("/?tab=myTeams");
  await page.getByRole("link", { name: "Team KPIs of AAA" }).click();
  await expect(page).toHaveURL(/\/teams\/\d+\/kpis/);
}

// Fill the prefilled create form and Create; answer the activate prompt; land back on the list.
async function createKpi(page: Page, title: string, activate: boolean): Promise<number> {
  await page.getByRole("link", { name: "New team KPI" }).click();
  await expect(page).toHaveURL(/\/team-kpis\/new/);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Target").fill("50");
  const [created] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/team-kpis") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Create", exact: true }).click(),
  ]);
  const id = (await created.json()).id as number;
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Do you want to activate the KPI immediately?")).toBeVisible();
  await dialog.getByRole("button", { name: activate ? "Yes" : "No", exact: true }).click();
  await expect(page).toHaveURL(/\/teams\/\d+\/kpis/);
  return id;
}

// The row for a KPI, located by its unique title.
function kpiRow(page: Page, title: string) {
  return page.locator("tr", { hasText: title });
}

// Cleanup: bring the KPI back to DRAFT if needed, then delete it from the DRAFT editor.
async function deleteKpi(page: Page, id: number): Promise<void> {
  await page.goto(`/team-kpis/${id}/view`);
  const deactivate = page.getByRole("button", { name: "Return to draft", exact: true });
  const editLink = page.getByRole("link", { name: "Edit", exact: true });
  await expect(deactivate.or(editLink).first()).toBeVisible();
  if (await deactivate.isVisible()) {
    await deactivate.click();
    await expect(page).toHaveURL(/\/team-kpis$/); // the action navigated to the default backTo
    await page.goto(`/team-kpis/${id}/edit`);
  } else {
    await editLink.click();
  }
  await expect(page).toHaveURL(new RegExp(`/team-kpis/${id}/edit`));
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Delete this draft KPI?")).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/v1/team-kpis/${id}`) && r.request().method() === "DELETE" && r.ok(),
    ),
    dialog.getByRole("button", { name: "Delete", exact: true }).click(),
  ]);
}

test("a manager walks a team KPI around the whole lifecycle, and the Graph plots the progress", async ({ page }) => {
  const title = uniqueText("E2E-kpi-cycle");

  await login(page, MANAGER_AAA);
  await gotoTeamKpis(page);
  const id = await createKpi(page, title, false); // "No" keeps the draft
  await expect(kpiRow(page, title).getByText("Draft", { exact: true })).toBeVisible();

  // The DRAFT editor: Save & activate in one go (validated multi-submit).
  await kpiRow(page, title).getByRole("link", { name: `Edit team KPI ${title}` }).click();
  await expect(page).toHaveURL(new RegExp(`/team-kpis/${id}/edit`));
  await page.getByRole("button", { name: "Save & activate", exact: true }).click();
  await expect(kpiRow(page, title).getByText("Active", { exact: true })).toBeVisible();

  // The ACTIVE editor is the progress form: record a value measured on an explicit past date
  // (the input defaults to today; backdating is allowed, the future is not).
  await kpiRow(page, title).getByRole("link", { name: `Edit team KPI ${title}` }).click();
  await page.getByLabel("Current").fill("30");
  await page.getByLabel("Value date").fill("2026-07-01");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/teams\/\d+\/kpis/);
  await expect(kpiRow(page, title).getByText("30", { exact: true })).toBeVisible();

  // The view shows the value's date; the Graph tab (also on the ACTIVE editor) plots the
  // recorded progress against the dashed target line.
  await page.goto(`/team-kpis/${id}/view`);
  await expect(page.getByText("(as of Jul 1, 2026)")).toBeVisible();
  await page.getByRole("tab", { name: "Graph" }).click();
  await expect(page.getByText("The KPI's value over time", { exact: false })).toBeVisible();
  await page.goto(`/team-kpis/${id}/edit`);
  await page.getByRole("tab", { name: "Graph" }).click();
  await expect(page.getByText("The KPI's value over time", { exact: false })).toBeVisible();
  await page.goto(`/team-kpis/${id}/view`);

  // Close from the view screen — the summary is mandatory.
  await page.getByRole("button", { name: "Close KPI", exact: true }).click();
  const closeDialog = page.getByRole("dialog");
  await closeDialog.getByLabel("Summary").fill("Wrapped up in the e2e run");
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/v1/team-kpis/${id}/close`) && r.request().method() === "POST" && r.ok(),
    ),
    closeDialog.getByRole("button", { name: "Close KPI", exact: true }).click(),
  ]);

  // Reopen — the record (summary included) survives the round-trip.
  await page.goto(`/team-kpis/${id}/view`);
  await expect(page.getByText("Wrapped up in the e2e run")).toBeVisible();
  await page.getByRole("button", { name: "Reopen", exact: true }).click();
  await expect(page).toHaveURL(/\/team-kpis$/);

  // Cleanup: back to draft, delete; gone from the drill-down list.
  await deleteKpi(page, id);
  await gotoTeamKpis(page);
  await expect(page.getByRole("heading", { name: /Team KPIs of AAA/ })).toBeVisible();
  await expect(kpiRow(page, title)).toHaveCount(0);
});

test("activating at creation notifies the members, who see the KPI read-only in My teams' KPIs", async ({ page }) => {
  const title = uniqueText("E2E-kpi-active");

  await login(page, MANAGER_AAA);
  await gotoTeamKpis(page);
  const id = await createKpi(page, title, true); // "Yes" activates on the spot
  await expect(kpiRow(page, title).getByText("Active", { exact: true })).toBeVisible();

  // A member: bell notification naming the KPI and the team, whose link opens the document.
  await logout(page);
  await login(page, AAA_ONE);
  const dialog = await openBell(page);
  const note = notificationCard(dialog, `Manager AAA activated the KPI "${title}" for team AAA`);
  await expect(note).toBeVisible();
  await note.getByRole("button", { name: "Go to" }).click();
  await expect(page).toHaveURL(new RegExp(`/team-kpis/${id}/view`));
  await expect(page.getByText(title)).toBeVisible();
  // Read-only from the member's side: no lifecycle actions, no Edit.
  await expect(page.getByRole("button", { name: "Close KPI" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);

  // The nav page lists it under "My teams' KPIs".
  await page.goto("/team-kpis");
  await expect(kpiRow(page, title).getByText("Active", { exact: true })).toBeVisible();
  await expect(kpiRow(page, title).getByRole("link", { name: `View team KPI ${title}` })).toBeVisible();
  await expect(kpiRow(page, title).getByRole("link", { name: `Edit team KPI ${title}` })).toHaveCount(0);

  // Cleanup: the manager deactivates and deletes.
  await logout(page);
  await login(page, MANAGER_AAA);
  await deleteKpi(page, id);
});
