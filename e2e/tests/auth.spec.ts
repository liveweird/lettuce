import { test, expect, login, logout, ADMIN } from "./helpers";

test("admin can log in and log out", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await logout(page);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("invalid credentials are rejected", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email" }).fill(ADMIN);
  await page.getByRole("textbox", { name: "Password" }).fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/invalid email or password/i)).toBeVisible();
});
