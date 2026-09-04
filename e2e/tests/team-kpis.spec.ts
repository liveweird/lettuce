import { fillDate, AAA_ONE, expect, login, logout, MANAGER_AAA, notificationCard, openBell, rowByTitle, test, uniqueText } from "./helpers";
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

// Add a data point on the view screen's KPI data tab (assumes the tab is open).
async function addValue(page: Page, id: number, date: string, value: string): Promise<void> {
  await fillDate(page, "Date", date);
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
  await expect(rowByTitle(page, title).getByText("Draft", { exact: true })).toBeVisible();

  // The manager's DRAFT row opens the definition editor directly (v1.29.1).
  await rowByTitle(page, title).getByRole("link", { name: `Edit team KPI ${title}` }).click();
  await expect(page).toHaveURL(new RegExp(`/team-kpis/${id}/edit`));
  // v2.41.0: flip the target direction — churn-style, staying at or below 50 is good.
  // (combobox role: a Mantine Select's mounted listbox shares the label — strict-mode trap.)
  await page.getByRole("combobox", { name: "Direction" }).click();
  await page.getByRole("option", { name: "At most" }).click();
  await page.getByRole("button", { name: "Save & activate", exact: true }).click();
  await expect(rowByTitle(page, title).getByText("Active", { exact: true })).toBeVisible();

  // The KPI data tab: add a backdated point and a later one, correct the first, remove the
  // second — every operation persists immediately (no Save button on the screen).
  await rowByTitle(page, title).getByRole("link", { name: `View team KPI ${title}` }).click();
  // General shows the target with its direction glyph (v2.41.0) — anchor on the view URL
  // first, or the assert can match the LIST's Target cells before navigation completes.
  await expect(page).toHaveURL(new RegExp(`/team-kpis/${id}/view`));
  await expect(page.getByText("≤ 50", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "KPI data" }).click();
  await expect(page.getByText("No data points yet.")).toBeVisible();
  await addValue(page, id, "2026-07-01", "30");
  await addValue(page, id, "2026-07-10", "40");
  await expect(page.getByRole("cell", { name: "Jul 1, 2026", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Jul 10, 2026", exact: true })).toBeVisible();
  // Each row states its distance from the ≤ 50 target (v2.41.0): 30 → -20, 40 → -10.
  await expect(page.getByRole("columnheader", { name: "Vs target" })).toBeVisible();
  await expect(page.getByText("-20", { exact: true })).toBeVisible();
  await expect(page.getByText("-10", { exact: true })).toBeVisible();

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
  await expect(rowByTitle(page, title).getByText("35", { exact: true })).toBeVisible();

  // Archive from the view screen — the summary is mandatory.
  await rowByTitle(page, title).getByRole("link", { name: `View team KPI ${title}` }).click();
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
  await expect(rowByTitle(page, title)).toHaveCount(0);
});

test("activating at creation notifies the members, who record data but drive no lifecycle", async ({ page }) => {
  const title = uniqueText("E2E-kpi-active");

  await login(page, MANAGER_AAA);
  await gotoTeamKpis(page);
  const id = await createKpi(page, title, true); // "Yes" activates on the spot
  await expect(rowByTitle(page, title).getByText("Active", { exact: true })).toBeVisible();

  // The manager records a data point — members are notified about that too (v1.30.0).
  await rowByTitle(page, title).getByRole("link", { name: `View team KPI ${title}` }).click();
  await page.getByRole("tab", { name: "KPI data" }).click();
  await addValue(page, id, "2026-07-27", "42");

  // A member: bell notifications naming the KPI and the team; the activation's link opens the
  // document.
  await logout(page);
  await login(page, AAA_ONE);
  const dialog = await openBell(page);
  await expect(
    notificationCard(dialog, `Manager AAA recorded 42 for Jul 27, 2026 on the KPI "${title}" of team AAA`),
  ).toBeVisible();
  const note = notificationCard(dialog, `Manager AAA activated the KPI "${title}" for team AAA`);
  await expect(note).toBeVisible();
  await note.getByRole("button", { name: "Go to" }).click();
  await expect(page).toHaveURL(new RegExp(`/team-kpis/${id}/view`));
  // exact: the notification wordings also contain the title as a substring.
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  // The member's side (v2.26.0): recording data is the team's shared work — the add row is
  // live and the member records a point — but the lifecycle stays the manager's: no
  // Archive/Return-to-draft actions, no Edit link.
  await expect(page.getByRole("button", { name: "Archive" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "KPI data" }).click();
  await addValue(page, id, "2026-07-28", "44");

  // The nav page lists it under "My teams' KPIs" — the row action is View here too.
  await page.goto("/team-kpis");
  await expect(rowByTitle(page, title).getByText("Active", { exact: true })).toBeVisible();
  await expect(rowByTitle(page, title).getByRole("link", { name: `View team KPI ${title}` })).toBeVisible();

  // Cleanup: the manager deactivates and deletes.
  await logout(page);
  await login(page, MANAGER_AAA);
  await deleteKpi(page, id);
});
