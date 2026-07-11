import { expect, login, logout, MANAGER_AAA, AAA_THREE, notificationCard, openBell, test, uniqueText } from "./helpers";
import type { Page } from "@playwright/test";

// 1:1 meetings: a manager documents outcomes of a recurring meeting with a direct report.
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
