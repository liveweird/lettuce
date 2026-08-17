import { test, expect, createUserViaUi, login, logout, switchLanguage, ADMIN } from "./helpers";

// The header language menu (native names — "Polski"/"English"): switching translates the
// chrome AND persists server-side (v2.21.0 — the one synced per-user language, applied to
// the UI at sign-in). The journey runs on a THROWAWAY user: seeded accounts must stay
// English, or parallel specs logging in as them would flip to Polish chrome.
test("language switch to Polish persists across reload and re-login", async ({ page }) => {
  await login(page, ADMIN);
  const user = await createUserViaUi(page, "E2E Lang");
  await logout(page);

  // Sign in through the real form (the cached-session helper bypasses the login response,
  // which is what applies the stored language).
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email" }).fill(user.email);
  await page.getByRole("textbox", { name: "Password" }).fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The app restores the previously-intended page after sign-in (the loginWithPassword
  // helper's documented gotcha) — land deterministically on the dashboard.
  await expect(page.getByRole("button", { name: /User menu|Menu użytkownika/ })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await switchLanguage(page, "Polski");
  await expect(page.getByRole("heading", { name: "Pulpit" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Moi podwładni" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Pulpit" })).toBeVisible();

  // The sync proof: wipe ALL device state (the localStorage language included) and sign in
  // afresh — the UI comes up Polish purely from the server-stored language.
  await page.evaluate(() => localStorage.clear());
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email" }).fill(user.email);
  await page.getByRole("textbox", { name: "Password" }).fill(user.password);
  await page.getByRole("button", { name: "Zaloguj się" }).or(page.getByRole("button", { name: "Sign in" })).click();
  await expect(page.getByRole("button", { name: /User menu|Menu użytkownika/ })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Pulpit" })).toBeVisible();
});
