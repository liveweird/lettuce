import {
  expect,
  login,
  logout,
  MANAGER_AAA,
  AAA_THREE,
  notificationCard,
  openBell,
  openFilters,
  test,
  uniqueText,
} from "./helpers";
import type { Page } from "@playwright/test";

// 1:1 meetings: a manager documents outcomes of a recurring meeting with a report.
// Manager AAA ↔ AAA Three (the least-used seeded pair). Meetings are new rows, so seeded
// accounts are never mutated; every spec cleans up the meetings it creates.

const today = () => new Date().toISOString().slice(0, 10);

async function createMeeting(page: Page, subordinate: string): Promise<number> {
  await page.goto("/one-on-ones");
  await page.getByRole("link", { name: "New 1:1" }).click();
  await expect(page).toHaveURL(/\/one-on-ones\/new/);
  const select = page.getByRole("combobox", { name: "Team member" });
  await select.click();
  await page.getByRole("option", { name: subordinate }).click();
  await page.getByLabel("Meeting date").fill(today());
  const [created] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/one-on-ones") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Create" }).click(),
  ]);
  const id = (await created.json()).id as number;
  await expect(page).toHaveURL(new RegExp(`/one-on-ones/${id}/edit`));
  return id;
}

async function saveMeeting(page: Page, id: number): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/api/v1/one-on-ones/${id}`) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
}

async function deleteMeeting(page: Page, id: number): Promise<void> {
  await page.goto(`/one-on-ones/${id}/edit`);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Delete this 1:1 meeting?")).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/api/v1/one-on-ones/${id}`) && r.request().method() === "DELETE" && r.ok(),
    ),
    dialog.getByRole("button", { name: "Delete", exact: true }).click(),
  ]);
}

test("a manager documents a 1:1 (points, decisions, action items), views it, and deletes it", async ({ page }) => {
  const point = uniqueText("E2E-1on1-point");
  const decision = uniqueText("E2E-1on1-decision");
  const action = uniqueText("E2E-1on1-action");

  await login(page, MANAGER_AAA);
  const id = await createMeeting(page, "AAA Three");

  // Document the meeting on the edit screen the create landed on.
  await page.getByRole("button", { name: "Add point" }).click();
  await page.getByRole("textbox", { name: "Points discussed — entry 1" }).fill(point);
  await page.getByRole("button", { name: "Add decision" }).click();
  await page.getByRole("textbox", { name: "Decisions made — entry 1" }).fill(decision);
  await page.getByRole("button", { name: "Add action item" }).click();
  // Carry-over from earlier runs may already occupy leading positions — fill the last entry.
  await page.getByRole("textbox", { name: /Action items — entry \d+/ }).last().fill(action);
  await saveMeeting(page, id);

  // The read-only document shows everything.
  await page.goto(`/one-on-ones/${id}/view`);
  await expect(page.getByText(point)).toBeVisible();
  await expect(page.getByText(decision)).toBeVisible();
  await expect(page.getByText(action)).toBeVisible();

  // ...and the action items render as a TABLE at this desktop width (v3.25.2). A stacked
  // ResponsiveTable still contains every cell, so the three assertions above passed throughout
  // the v3.4.0 regression that left this table in its mobile card layout at every viewport (the
  // detail shell's `Container md` gives it 926px, under the `wide` preset's 68rem threshold).
  // Only the computed display can see it.
  await expect
    .poll(() => page.locator("table").first().evaluate((el) => getComputedStyle(el).display))
    .toBe("table");

  // The managed tab lists it.
  await page.goto("/one-on-ones?tab=managed");
  await expect(page.locator(`a[href*="/one-on-ones/${id}/edit"]`).first()).toBeVisible();

  // Delete (confirmation modal) — gone from the list afterwards.
  await deleteMeeting(page, id);
  await page.goto("/one-on-ones?tab=managed");
  await expect(page.getByRole("heading", { name: "1:1 meetings" })).toBeVisible();
  await expect(page.locator(`a[href*="/one-on-ones/${id}/"]`)).toHaveCount(0);
});

test("open action items carry over to the next 1:1 and the subordinate is notified", async ({ page }) => {
  const action = uniqueText("E2E-1on1-carry");

  await login(page, MANAGER_AAA);

  // Meeting 1: one unresolved action item.
  const first = await createMeeting(page, "AAA Three");
  await page.getByRole("button", { name: "Add action item" }).click();
  await page.getByRole("textbox", { name: /Action items — entry \d+/ }).last().fill(action);
  await saveMeeting(page, first);

  // Meeting 2 with the same person: the open item is carried over server-side at create.
  const second = await createMeeting(page, "AAA Three");
  await expect(page.getByText("Carried over").first()).toBeVisible();
  await page.goto(`/one-on-ones/${second}/view`);
  await expect(page.getByText(action)).toBeVisible();

  // With both of the pair's meetings still live, "Latest 1:1 only" narrows the managed list
  // down to just the newest.
  // Row links, not Edit links: only the pair's latest meeting is editable, so the older row
  // carries a view link only.
  const rowLink = (id: number) => page.locator(`a[href*="/one-on-ones/${id}/"]`);
  await page.goto("/one-on-ones?tab=managed");
  await expect(rowLink(second).first()).toBeVisible();
  await expect(rowLink(first).first()).toBeVisible();
  await openFilters(page);
  await page.getByRole("switch", { name: "Latest 1:1 only" }).click();
  await expect(rowLink(second).first()).toBeVisible();
  await expect(rowLink(first)).toHaveCount(0);

  // The subordinate is notified and sees the meeting read-only in their own tab.
  await logout(page);
  await login(page, AAA_THREE);
  const dialog = await openBell(page);
  await expect(
    notificationCard(dialog, "Manager AAA documented a 1:1 meeting with you"),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/one-on-ones");
  await expect(page.locator(`a[href*="/one-on-ones/${second}/view"]`).first()).toBeVisible();
  await expect(page.locator(`a[href*="/one-on-ones/${second}/edit"]`)).toHaveCount(0);
  await page.goto(`/one-on-ones/${second}/view`);
  await expect(page.getByText(action)).toBeVisible();

  // Cleanup: the manager deletes both meetings.
  await logout(page);
  await login(page, MANAGER_AAA);
  await deleteMeeting(page, second);
  await deleteMeeting(page, first);
  await page.goto("/one-on-ones?tab=managed");
  await expect(page.getByRole("heading", { name: "1:1 meetings" })).toBeVisible();
  await expect(page.locator(`a[href*="/one-on-ones/${first}/"]`)).toHaveCount(0);
});

test("the edit screen's New 1:1 button saves in-progress notes and starts a fresh meeting with the same person", async ({ page }) => {
  const note = uniqueText("E2E-1on1-new-button-note");

  await login(page, MANAGER_AAA);
  const firstId = await createMeeting(page, "AAA Three");

  // Add a note but don't Save — the New 1:1 button's own prompt handles the unsaved work.
  await page.getByRole("button", { name: "Add point" }).click();
  await page.getByRole("textbox", { name: "Points discussed — entry 1" }).fill(note);

  await page.getByRole("button", { name: "New 1:1" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Save changes before starting a new 1:1?")).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/api/v1/one-on-ones/${firstId}`) && r.request().method() === "PUT" && r.ok(),
    ),
    dialog.getByRole("button", { name: "Save and continue" }).click(),
  ]);

  // Lands on the create screen with the subordinate locked in (a chip, not the picker).
  await expect(page).toHaveURL(/\/one-on-ones\/new\?subordinateId=/);
  await expect(page.getByRole("combobox", { name: "Team member" })).toHaveCount(0);
  await expect(page.locator("#main-content").getByText("AAA Three")).toBeVisible();

  await page.getByLabel("Meeting date").fill(today());
  const [created] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/one-on-ones") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Create" }).click(),
  ]);
  const secondId = (await created.json()).id as number;
  await expect(page).toHaveURL(new RegExp(`/one-on-ones/${secondId}/edit`));

  // The new meeting exists on the managed tab...
  await page.goto("/one-on-ones?tab=managed");
  await expect(page.locator(`a[href*="/one-on-ones/${secondId}/edit"]`).first()).toBeVisible();

  // ...and the OLD meeting — no longer the pair's latest, hence read-only — shows the saved
  // note on its view.
  await page.goto(`/one-on-ones/${firstId}/view`);
  await expect(page.getByText(note)).toBeVisible();

  // Cleanup: delete both meetings.
  await deleteMeeting(page, secondId);
  await deleteMeeting(page, firstId);
  await page.goto("/one-on-ones?tab=managed");
  await expect(page.getByRole("heading", { name: "1:1 meetings" })).toBeVisible();
  await expect(page.locator(`a[href*="/one-on-ones/${firstId}/"]`)).toHaveCount(0);
  await expect(page.locator(`a[href*="/one-on-ones/${secondId}/"]`)).toHaveCount(0);
});
