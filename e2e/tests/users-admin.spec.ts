import {
  test,
  expect,
  login,
  logout,
  createUserViaUi,
  expectLoginRejected,
  ADMIN,
  openFilters,
} from "./helpers";

// Admin user management beyond create/rename (user-edit.spec.ts): role change, the two
// password-change flows (admin reset vs. self-change with current password), and delete.
// Everything runs on throwaway users created through the real UI — seeded accounts that other
// specs log in with are never mutated.

test("the one-time password is masked until revealed, and hides again", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/users/new");
  const name = `E2E-Reveal ${Date.now()}`;
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page
    .getByRole("textbox", { name: "Email" })
    .fill(`${name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}@lettuce.local`);
  await page.getByRole("button", { name: "Create" }).click();

  const dialog = page.getByRole("dialog");
  const code = dialog.locator("code");
  await expect(code).toHaveText(/^\*+$/); // masked by default
  await dialog.getByRole("button", { name: "Show password" }).click();
  await expect(code).toHaveText(/^[A-Za-z0-9_-]{16}$/); // revealed
  await dialog.getByRole("button", { name: "Hide password" }).click();
  await expect(code).toHaveText(/^\*+$/); // hidden again
  await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
});

test("admin grants and revokes the Admin role", async ({ page }) => {
  await login(page, ADMIN);
  const user = await createUserViaUi(page, "E2E-Role");

  // Grant: pick Admin in the Roles multi-select (a new user starts with no additional roles).
  await page.goto(`/users/${user.id}/edit`);
  const rolesField = page.getByRole("combobox", { name: "Roles" });
  await rolesField.click();
  await page.getByRole("option", { name: "Admin" }).click();
  // A multi-select keeps its dropdown open for further picks — close it so it can't cover Save.
  await page.keyboard.press("Escape");
  await Promise.all([
    page.waitForResponse(
      (r) => new RegExp(`/api/v1/users/${user.id}$`).test(r.url()) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save" }).click(),
  ]);

  // The grant survived: the edit form shows the Admin pill. Scope to the main content —
  // Mantine keeps the (hidden) dropdown option markup in the DOM outside it even when closed.
  await page.goto(`/users/${user.id}/edit`);
  const adminPill = page.locator("#main-content").getByText("Admin", { exact: true });
  await expect(adminPill).toBeVisible();

  // Revoke: focus the field (NOT click — with a pill present Mantine hides the inner input and
  // the wrapper intercepts pointer events) and Backspace removes the last pill. The pill's
  // remove button carries no accessible name, so the keyboard path is the reliable one.
  await page.getByRole("combobox", { name: "Roles" }).focus();
  await page.keyboard.press("Backspace");
  await expect(adminPill).toHaveCount(0);
  await Promise.all([
    page.waitForResponse(
      (r) => new RegExp(`/api/v1/users/${user.id}$`).test(r.url()) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save" }).click(),
  ]);
  await page.goto(`/users/${user.id}/edit`);
  await expect(page.getByRole("combobox", { name: "Roles" })).toBeVisible();
  await expect(adminPill).toHaveCount(0);
});

test("admin resets a password; the user then changes their own (current password required)", async ({
  page,
}) => {
  const resetPassword = "e2e-Reset-Pass-1";
  const selfPassword = "e2e-Self-Pass-2";
  await login(page, ADMIN);
  const user = await createUserViaUi(page, "E2E-Pass");

  // The generated password from the reveal modal works.
  await logout(page);
  await login(page, user.email, user.password);
  await logout(page);

  // Admin reset: no current-password field.
  await login(page, ADMIN);
  await page.goto(`/users/${user.id}/change-password`);
  await expect(page.getByLabel("Current password")).toHaveCount(0);
  await page.getByRole("textbox", { name: "New password" }).fill(resetPassword);
  await page.getByRole("textbox", { name: "Confirm password" }).fill(resetPassword);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/users/${user.id}/password`) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Change password" }).click(),
  ]);
  await logout(page);
  await login(page, user.email, resetPassword);

  // Self-change: a wrong current password is rejected (403 → inline error)…
  await page.goto(`/users/${user.id}/change-password`);
  await page.getByRole("textbox", { name: "Current password" }).fill("definitely-wrong-1");
  await page.getByRole("textbox", { name: "New password" }).fill(selfPassword);
  await page.getByRole("textbox", { name: "Confirm password" }).fill(selfPassword);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("The current password is incorrect.")).toBeVisible();

  // …the correct one goes through.
  await page.getByRole("textbox", { name: "Current password" }).fill(resetPassword);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/users/${user.id}/password`) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Change password" }).click(),
  ]);
  await logout(page);

  // Old password rejected, new one works.
  await expectLoginRejected(page, user.email, resetPassword);
  await login(page, user.email, selfPassword);
});

test("admin deletes a user; the deleted account can no longer sign in", async ({ page }) => {
  await login(page, ADMIN);
  const user = await createUserViaUi(page, "E2E-Delete");

  await page.goto("/users");
  await openFilters(page);
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByRole("button", { name: `Delete ${user.name}` }).click();
  await Promise.all([
    page.waitForResponse(
      (r) => new RegExp(`/api/v1/users/${user.id}$`).test(r.url()) && r.request().method() === "DELETE" && r.ok(),
    ),
    page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click(),
  ]);
  // Verify against a fresh load — the in-place list can lose a refetch race with a stale
  // in-flight response.
  await page.goto("/users");
  await openFilters(page);
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await expect(page.getByText("No users")).toBeVisible();
  await logout(page);

  await expectLoginRejected(page, user.email, user.password);
});
