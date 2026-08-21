import { ADMIN, expect, login, logout, openUserMenu, PASSWORD, test, uniqueText } from "./helpers";

// The email-mirror opt-out (v2.3.0): the header account menu opens the self-service screen,
// the switch persists through save + reload, and turning it back on persists too. Runs on a
// THROWAWAY user minted over the API — seeded accounts are never mutated, and a mid-run death
// strands nothing that other specs read (the flag only matters at email-send time).
test("a user opts out of email notifications from the account menu and opts back in", async ({
  page,
  request,
}) => {
  const name = uniqueText("E2E Mail Pref");
  const user = {
    name,
    email: `${name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}@lettuce.local`,
    password: `e2e-${uniqueText("pw")}`,
  };
  const adminLogin = await request.post("/api/v1/login", {
    data: { email: ADMIN, password: PASSWORD },
  });
  expect(adminLogin.ok()).toBeTruthy();
  const { token } = (await adminLogin.json()) as { token: string };
  const created = await request.post("/api/v1/users", {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: user.name, email: user.email, password: user.password },
  });
  expect(created.ok()).toBeTruthy();

  await login(page, user.email, user.password);
  // The screen is reached through the header account menu (its only entry point);
  // openUserMenu collapses any active alert banner overlaying the header first.
  await openUserMenu(page);
  await page.getByRole("menuitem", { name: "Email notifications" }).click();
  await expect(page).toHaveURL(/\/users\/\d+\/email-notifications/);
  const mirror = page.getByRole("switch", { name: "Send me an email for every notification" });
  await expect(mirror).toBeChecked(); // the default: mirror on

  // Opt out → toast + redirect home; the choice survives a reload of the screen.
  await mirror.click();
  await expect(mirror).not.toBeChecked();
  await Promise.all([
    page.waitForResponse(
      (r) => /\/email-notifications$/.test(r.url()) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
  await expect(page.getByText("Email notification settings saved")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await openUserMenu(page);
  await page.getByRole("menuitem", { name: "Email notifications" }).click();
  await expect(mirror).not.toBeChecked();

  // …and back on.
  await mirror.click();
  await Promise.all([
    page.waitForResponse(
      (r) => /\/email-notifications$/.test(r.url()) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
  await expect(page.getByText("Email notification settings saved")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await openUserMenu(page);
  await page.getByRole("menuitem", { name: "Email notifications" }).click();
  await expect(mirror).toBeChecked();

  // The admin-for-another-user branch (2026-08 audit round): the same screen opened by an
  // ADMIN on someone else's id saves the target's flag and returns to /users, not home.
  const { id: userId } = (await created.json()) as { id: number };
  await logout(page);
  await login(page, ADMIN);
  await page.goto(`/users/${userId}/email-notifications`);
  await expect(page.getByText(user.email)).toBeVisible();
  await expect(mirror).toBeChecked();
  await mirror.click();
  await Promise.all([
    page.waitForResponse(
      (r) => /\/email-notifications$/.test(r.url()) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
  await expect(page.getByText("Email notification settings saved")).toBeVisible();
  await expect(page).toHaveURL(/\/users$/);
  await page.goto(`/users/${userId}/email-notifications`);
  await expect(mirror).not.toBeChecked();
});
