import { AAA_ONE, expect, login, logout, MANAGER_AAA, notificationCard, openBell, test, uniqueText } from "./helpers";
import type { Page } from "@playwright/test";

// Team KPIs: a manager defines a KPI for a team they manage and walks it around the
// DRAFT <-> ACTIVE <-> ARCHIVED machine; members see it once active. The view screen is THE
// KPI screen (v1.29.0): tabs General / KPI data / Graph / History, the manager's data-point
// editing inline on the KPI data tab, lifecycle actions at the bottom. Manager AAA ↔ team AAA
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

// Add a data point on the view screen's KPI data tab (assumes the tab is open).
async function addValue(page: Page, id: number, date: string, value: string): Promise<void> {
  await page.getByLabel("Date", { exact: true }).fill(date);
  await page.getByLabel("Value", { exact: true }).fill(value);
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/v1/team-kpis/${id}/values`) &&
        r.request().method() === "POST" &&
        r.ok(),
    ),
    page.getByRole("button", { name: "Add value", exact: true }).click(),
  ]);
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

test("a manager walks a team KPI around the whole lifecycle, managing its data points inline", async ({ page }) => {
  const title = uniqueText("E2E-kpi-cycle");

  await login(page, MANAGER_AAA);
  await gotoTeamKpis(page);
  const id = await createKpi(page, title, false); // "No" keeps the draft
  await expect(kpiRow(page, title).getByText("Draft", { exact: true })).toBeVisible();

  // The row action is always View; the DRAFT editor is reached via the view's Edit link.
  await kpiRow(page, title).getByRole("link", { name: `View team KPI ${title}` }).click();
  await expect(page).toHaveURL(new RegExp(`/team-kpis/${id}/view`));
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/team-kpis/${id}/edit`));
  await page.getByRole("button", { name: "Save & activate", exact: true }).click();
  await expect(kpiRow(page, title).getByText("Active", { exact: true })).toBeVisible();

  // The KPI data tab: add a backdated point and a later one, correct the first, remove the
  // second — every operation persists immediately (no Save button on the screen).
  await kpiRow(page, title).getByRole("link", { name: `View team KPI ${title}` }).click();
  await page.getByRole("tab", { name: "KPI data" }).click();
  await expect(page.getByText("No data points yet.")).toBeVisible();
  await addValue(page, id, "2026-07-01", "30");
  await addValue(page, id, "2026-07-10", "40");
  await expect(page.getByRole("cell", { name: "Jul 1, 2026", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Jul 10, 2026", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Edit the value of Jul 1, 2026" }).click();
  await page.getByRole("row", { name: /Jul 1, 2026/ }).getByLabel("Value", { exact: true }).fill("35");
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/api/v1/team-kpis/${id}/values/`) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save the value of Jul 1, 2026" }).click(),
  ]);
  await expect(page.getByRole("cell", { name: "35", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Remove the value of Jul 10, 2026" }).click();
  const removeDialog = page.getByRole("dialog");
  await expect(removeDialog.getByText("Remove this data point?")).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/api/v1/team-kpis/${id}/values/`) && r.request().method() === "DELETE" && r.ok(),
    ),
    removeDialog.getByRole("button", { name: "Delete", exact: true }).click(),
  ]);
  await expect(page.getByRole("cell", { name: "Jul 10, 2026", exact: true })).toHaveCount(0);

  // The Graph tab plots the remaining point against the dashed target line.
  await page.getByRole("tab", { name: "Graph" }).click();
  await expect(page.getByText("The KPI's value over time", { exact: false })).toBeVisible();

  // The list's Current column reflects the max-dated point (35 after the removal).
  await gotoTeamKpis(page);
  await expect(kpiRow(page, title).getByText("35", { exact: true })).toBeVisible();

  // Archive from the view screen — the summary is mandatory.
  await kpiRow(page, title).getByRole("link", { name: `View team KPI ${title}` }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  const archiveDialog = page.getByRole("dialog");
  await archiveDialog.getByLabel("Summary").fill("Wrapped up in the e2e run");
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/v1/team-kpis/${id}/archive`) && r.request().method() === "POST" && r.ok(),
    ),
    archiveDialog.getByRole("button", { name: "Archive", exact: true }).click(),
  ]);

  // Reopen — the record (summary included) survives the round-trip.
  await page.goto(`/team-kpis/${id}/view`);
  await expect(page.getByText("Wrapped up in the e2e run")).toBeVisible();
  await expect(page.getByText("Archived", { exact: true })).toBeVisible();
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
  // Read-only from the member's side: no lifecycle actions, no Edit, no data-point editing.
  await expect(page.getByRole("button", { name: "Archive" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "KPI data" }).click();
  await expect(page.getByRole("button", { name: "Add value" })).toHaveCount(0);

  // The nav page lists it under "My teams' KPIs" — the row action is View here too.
  await page.goto("/team-kpis");
  await expect(kpiRow(page, title).getByText("Active", { exact: true })).toBeVisible();
  await expect(kpiRow(page, title).getByRole("link", { name: `View team KPI ${title}` })).toBeVisible();

  // Cleanup: the manager deactivates and deletes.
  await logout(page);
  await login(page, MANAGER_AAA);
  await deleteKpi(page, id);
});
