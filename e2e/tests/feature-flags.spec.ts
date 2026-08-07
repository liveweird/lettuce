import { test, expect, ADMIN, login, logout, createUserViaUi, gotoUserRow, openFilters } from "./helpers";

// Per-user feature flags (v1.53.0): admin disables Goals for a fresh user via the per-user
// editor (/users/:id/features, reached from the Modify ▾ menu), the victim loses the feature
// end to end (nav link gone, direct URL bounces home), then the admin re-enables it via the
// per-feature screen (/feature-flags) and the victim gets it back. Fresh prefix-unique user
// per run — no shared-DB residue, nothing to sweep.
test("admin toggles a user's Goals feature via both surfaces; the user's UI follows", async ({ page }) => {
  await login(page, ADMIN);
  const user = await createUserViaUi(page, "E2E FeatureFlag");

  // Disable Goals via the per-user editor.
  await gotoUserRow(page, user.name);
  await page.getByRole("button", { name: `Modify actions for ${user.name}` }).click();
  await page.getByRole("menuitem", { name: `Features of ${user.name}` }).click();
  await expect(page).toHaveURL(new RegExp(`/users/${user.id}/features$`));
  const goalsSwitch = page.getByRole("switch", { name: "Goals" });
  await expect(goalsSwitch).toBeChecked();
  await goalsSwitch.click();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/api/v1/users/${user.id}/features`) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save" }).click(),
  ]);
  await expect(page).toHaveURL(/\/users$/);
  await logout(page);

  // The victim: no Goals nav link, and the direct URL bounces to the dashboard.
  await login(page, user.email, user.password);
  await expect(page.getByRole("link", { name: "Feedback", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Goals", exact: true })).toHaveCount(0);
  await page.goto("/goals");
  await expect(page.getByRole("button", { name: "User menu" })).toBeVisible();
  await expect(page).not.toHaveURL(/\/goals/);
  await logout(page);

  // Re-enable via the per-feature screen: pick Goals, filter to disabled users + the unique
  // email (shared-DB rule: never assume page 1), flip the row switch.
  await login(page, ADMIN);
  await page.goto("/feature-flags");
  await openFilters(page);
  await page.getByRole("combobox", { name: "Feature" }).click();
  await page.getByRole("option", { name: "Goals" }).click();
  await page.getByRole("combobox", { name: "State" }).click();
  await page.getByRole("option", { name: "Disabled" }).click();
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  const rowSwitch = page.getByRole("switch", { name: `Toggle Goals for ${user.name}` });
  await expect(rowSwitch).not.toBeChecked();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/api/v1/users/${user.id}/features`) && r.request().method() === "PUT" && r.ok(),
    ),
    // force: the bare-label row Switch keeps its role=switch input visually hidden under the
    // track, so an actionability-checked click retries forever (the labeled editor switches
    // above don't need this).
    rowSwitch.click({ force: true }),
  ]);
  await logout(page);

  // The victim again: Goals restored (fresh login carries the fresh flags).
  await login(page, user.email, user.password);
  await expect(page.getByRole("link", { name: "Goals", exact: true })).toBeVisible();
  await page.goto("/goals");
  await expect(page).toHaveURL(/\/goals/);
  await expect(page.getByRole("heading", { name: "Goals" })).toBeVisible();
});
