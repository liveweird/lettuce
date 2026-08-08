import { test, expect, expectLoginRejected, loginWithPassword, logout, ADMIN } from "./helpers";

test("admin can log in and log out", async ({ page }) => {
  // The one deliberate opt-out from the minted-session fast path: this spec exists to exercise
  // the real login form, so it must submit credentials like a user does.
  await loginWithPassword(page, ADMIN);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await logout(page);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("invalid credentials are rejected", async ({ page }) => {
  // Via the shared helper: it waits out the per-IP /login rate limit (429) and resubmits, so
  // the assertion always sees the server's actual credential verdict — the spec runs early,
  // right after the global-setup cleanup logins have strained the bucket.
  await expectLoginRejected(page, ADMIN, "wrong-password");
});
