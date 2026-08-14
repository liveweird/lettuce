import { test, expect, login, logout, createUserViaUi, notificationCard, openBell, pickSelectOption, uniqueText, ADMIN } from "./helpers";
import type { Page } from "@playwright/test";

// The career progression journey (v2.15.0): the admin's user form has NO career fields anymore;
// a throwaway manager records positions for a throwaway subordinate from the subordinates-card
// drill-down (start → conclude-by-starting-another → correct a date → delete), the current
// position feeds the details card's Profile section, the subordinate gets the notification and
// a read-only view of their own timeline, and a dictionary rename still propagates through the
// position's entry ref (the old user-edit acceptance scenario, re-homed). Owns all its state:
// throwaway users + team per run, plus one appended-then-retired career-paths entry (the same
// shared-dictionary etiquette the retired user-edit career leg used).

// The dictionary whole-document save cycle (the dictionaries.spec helper): wait for the PUT
// AND the re-seeding GET, then for the Save button to leave its loading state.
async function saveDictionary(page: Page, slug: string) {
  const save = page.getByRole("button", { name: "Save", exact: true });
  const isDictionaryCall = (r: { url(): string }) => r.url().endsWith(`/api/v1/dictionaries/${slug}`);
  await Promise.all([
    page.waitForResponse((r) => isDictionaryCall(r) && r.request().method() === "PUT" && r.ok()),
    page.waitForResponse((r) => isDictionaryCall(r) && r.request().method() === "GET" && r.ok()),
    save.click(),
  ]);
  await expect(save).not.toHaveAttribute("data-loading", /.*/);
  await expect(save).toBeDisabled();
}

const isPositionsCall = (r: { url(): string }) => /\/api\/v1\/users\/\d+\/career-positions/.test(r.url());

test("career progression: chain manager records positions, the person sees the timeline", async ({ page }) => {
  const value1 = uniqueText("E2E-Career-Pos");
  const value2 = `${value1}-renamed`;
  await login(page, ADMIN);

  // 1. Throwaway people + team: M manages S. Passwords come from the one-time reveal modal.
  const manager = await createUserViaUi(page, "E2E Career Mgr");
  const sub = await createUserViaUi(page, "E2E Career Sub");
  const teamName = uniqueText("E2E Career Team");
  await page.goto("/teams/new");
  await page.getByRole("textbox", { name: "Name" }).fill(teamName);
  await pickSelectOption(page, "Manager", manager.name);
  const [teamCreated] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/teams") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Create" }).click(),
  ]);
  const teamId: number = (await teamCreated.json()).id;
  await page.goto(`/teams/${teamId}/details`);
  await pickSelectOption(page, "Add a user", sub.name);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/teams/${teamId}/members/`) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Add", exact: true }).click(),
  ]);

  // 2. A throwaway career-paths entry (the shared-dictionary append idiom).
  await page.goto("/dictionaries/career-paths");
  await expect(page.getByRole("button", { name: "Add entry", exact: true })).toBeVisible();
  const base = await page.getByLabel(/^Entry \d+ \(English\)$/).count();
  await page.getByRole("button", { name: "Add entry", exact: true }).click();
  await page.getByLabel(`Entry ${base + 1} (English)`, { exact: true }).fill(value1);
  await page.getByLabel(`Entry ${base + 1} (Polish)`, { exact: true }).fill(`${value1}-pl`);
  await saveDictionary(page, "career-paths");

  // 3. The admin user form lost its career fields (v2.15.0) — no pickers, no admin write.
  await page.goto(`/users/${sub.id}/edit`);
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue(sub.name);
  await expect(page.getByRole("combobox", { name: "Career path" })).toHaveCount(0);
  await logout(page);

  // 4. The manager drills in from the subordinates card and starts the first position.
  await login(page, manager.email, manager.password);
  await page.goto("/?tab=subordinates");
  await page.getByRole("link", { name: `Career progression of ${sub.name}` }).click();
  await expect(page.getByRole("heading", { name: `Career progression — ${sub.name}` })).toBeVisible();
  await expect(page.getByText("No positions recorded yet.")).toBeVisible();
  await page.getByLabel("Start date").fill("2024-01-01");
  const careerPath = page.getByRole("combobox", { name: "Career path" });
  await careerPath.click();
  await careerPath.fill(value1); // searchable — narrow the shared dictionary's long list
  await page.getByRole("option", { name: value1, exact: true }).click();
  await Promise.all([
    page.waitForResponse((r) => isPositionsCall(r) && r.request().method() === "POST" && r.ok()),
    page.getByRole("button", { name: "Start position" }).click(),
  ]);
  await expect(page.getByText("Current", { exact: true })).toBeVisible();
  // Scope past the editor's closed Select — its listbox stays MOUNTED with the picked option
  // (the Mantine gotcha), so an unscoped exact-text locator strict-violates against it.
  await expect(page.locator("#main-content").getByText(value1, { exact: true })).toBeVisible();

  // 5. Starting a second position concludes the first: exactly one Current badge, and the
  //    older row now shows a bounded range (no "Since" prefix on it anymore).
  await page.getByLabel("Start date").fill("2025-02-01");
  await careerPath.click();
  await careerPath.fill(value1);
  await page.getByRole("option", { name: value1, exact: true }).click();
  await Promise.all([
    page.waitForResponse((r) => isPositionsCall(r) && r.request().method() === "POST" && r.ok()),
    page.getByRole("button", { name: "Start position" }).click(),
  ]);
  await expect(page.getByText("Current", { exact: true })).toHaveCount(1);
  await expect(page.getByLabel("Edit the position started 2024-01-01")).toBeVisible();
  await expect(page.getByLabel("Edit the position started 2025-02-01")).toBeVisible();

  // 6. Correct the historical position's start date in place.
  await page.getByLabel("Edit the position started 2024-01-01").click();
  await page.getByLabel("Start date").fill("2024-03-01");
  await Promise.all([
    page.waitForResponse((r) => isPositionsCall(r) && r.request().method() === "PUT" && r.ok()),
    page.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
  await expect(page.getByLabel("Edit the position started 2024-03-01")).toBeVisible();

  // 7. Delete the newer position — the survivor reopens as Current.
  await page.getByLabel("Delete the position started 2025-02-01").click();
  await Promise.all([
    page.waitForResponse((r) => isPositionsCall(r) && r.request().method() === "DELETE" && r.ok()),
    page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click(),
  ]);
  await expect(page.getByLabel(/^Edit the position started /)).toHaveCount(1);
  await expect(page.getByText("Current", { exact: true })).toBeVisible();

  // 8. The current position backs the details card's Profile section.
  await page.goto(`/users/${sub.id}/details`);
  await expect(page.getByText(value1, { exact: true })).toBeVisible();
  await logout(page);

  // 9. The subordinate was notified and reads their own timeline WITHOUT the editor.
  await login(page, sub.email, sub.password);
  const dialog = await openBell(page);
  await expect(
    notificationCard(dialog, "recorded a new position in your career progression"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto(`/users/${sub.id}/career`);
  await expect(page.getByText("Current", { exact: true })).toBeVisible();
  await expect(page.getByText("Start a new position")).toHaveCount(0);
  await logout(page);

  // 10. A dictionary rename propagates through the position's entry ref; retiring the entry
  //     keeps it resolving (id-keyed storage — the old user-edit acceptance scenario).
  await login(page, ADMIN);
  await page.goto("/dictionaries/career-paths");
  await expect(page.getByRole("button", { name: "Add entry", exact: true })).toBeVisible();
  const lastEntry = page.getByLabel(/^Entry \d+ \(English\)$/).last();
  await expect(lastEntry).toHaveValue(value1); // our appended entry is still the tail
  await lastEntry.fill(value2);
  await saveDictionary(page, "career-paths");
  await page.goto(`/users/${sub.id}/details`);
  await expect(page.getByText(value2, { exact: true })).toBeVisible();
  await page.goto("/dictionaries/career-paths");
  await expect(page.getByRole("button", { name: "Add entry", exact: true })).toBeVisible();
  const count = await page.getByLabel(/^Entry \d+ \(English\)$/).count();
  await page.getByRole("button", { name: `Remove entry ${count}`, exact: true }).click();
  await saveDictionary(page, "career-paths");
  await page.goto(`/users/${sub.id}/career`);
  await expect(page.getByText(value2, { exact: true })).toBeVisible();
});
