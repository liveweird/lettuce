import {
  test,
  expect,
  login,
  logout,
  createUserViaUi,
  expectLoginRejected,
  ADMIN,
} from "./helpers";

// Admin user management beyond create/rename (user-edit.spec.ts): role change, the two
// password-change flows (admin reset vs. self-change with current password), and delete.
// Everything runs on throwaway users created through the real UI — seeded accounts that other
// specs log in with are never mutated.

test("admin promotes a user to Admin", async ({ page }) => {
  await login(page, ADMIN);
  const user = await createUserViaUi(page, "E2E-Role");

  await page.goto(`/users/${user.id}/edit`);
  await page.getByRole("combobox", { name: "Role" }).click();
  await page.getByRole("option", { name: "Admin" }).click();
  await Promise.all([
    page.waitForResponse(
      (r) => new RegExp(`/api/v1/users/${user.id}$`).test(r.url()) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save" }).click(),
  ]);
  await page.goto(`/users/${user.id}/edit`);
  await expect(page.getByRole("combobox", { name: "Role" })).toHaveValue("Admin");
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
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByRole("button", { name: `Delete ${user.name}` }).click();
  await Promise.all([
    page.waitForResponse(
      (r) => new RegExp(`/api/v1/users/${user.id}$`).test(r.url()) && r.request().method() === "DELETE" && r.ok(),
    ),
    page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click(),
  ]);
  await expect(page.getByText("No users")).toBeVisible();
  await logout(page);

  await expectLoginRejected(page, user.email, user.password);
});
