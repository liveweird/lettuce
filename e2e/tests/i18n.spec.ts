import { test, expect, login, switchLanguage, ADMIN } from "./helpers";

// The header language menu (native names — "Polski"/"English"): switching translates the
// chrome, the choice persists across a reload (localStorage lettuce.lang), and the spec ends
// back on EN as a courtesy (each test gets a fresh browser context, so this is hygiene, not a
// cross-spec dependency).
test("language switch to Polish persists across reload", async ({ page }) => {
  await login(page, ADMIN);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await switchLanguage(page, "Polski");
  await expect(page.getByRole("heading", { name: "Pulpit" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Moi podwładni" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Pulpit" })).toBeVisible();

  await switchLanguage(page, "English");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});
