import { test, expect, login, collapseAlertsBanner, ADMIN } from "./helpers";

// The PL/EN language switcher: switching translates the chrome, the choice persists across a
// reload (localStorage lettuce.lang), and the spec ends back on EN as a courtesy (each test gets
// a fresh browser context, so this is hygiene, not a cross-spec dependency).
test("language switch to Polish persists across reload", async ({ page }) => {
  await login(page, ADMIN);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  // A pre-existing active alert expands its banner over the header — collapse before
  // clicking header controls (the collapse persists in localStorage across the reload).
  await collapseAlertsBanner(page);

  // Mantine SegmentedControl hides the radio inputs; click the visible option labels. Match the
  // radiogroup by its aria-label in EITHER language — it flips to "Język" once PL is active.
  const switcher = page.getByRole("radiogroup", { name: /Language|Język/ });
  await switcher.getByText("PL", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pulpit" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Moi podwładni" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Pulpit" })).toBeVisible();

  await switcher.getByText("EN", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});
