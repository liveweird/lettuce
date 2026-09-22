import type { APIRequestContext } from "@playwright/test";
import {
  ADMIN,
  AAA_ONE,
  PASSWORD,
  clickAskForFeedback,
  expect,
  gotoUserRow,
  login,
  logout,
  notificationCard,
  openBell,
  openUserMenu,
  pickMultiSelectOptions,
  test,
  typeContent,
  uniqueText,
} from "./helpers";

// The v4.0.0 per-type notification preferences: the in-app/email matrix (replacing the old
// email-mirror-only screen) and the master "Send me emails" switch it still carries. Both
// scenarios run on a THROWAWAY user minted over the API — seeded accounts are never mutated.

async function mintUser(request: APIRequestContext, namePrefix: string) {
  const name = uniqueText(namePrefix);
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
  const { id } = (await created.json()) as { id: number };
  return { id, ...user };
}

test("a user turns off in-app for one type so a second actor's action mints no bell row while another type still arrives", async ({
  page,
  request,
}) => {
  const owner = await mintUser(request, "E2E Notif Prefs");

  await login(page, owner.email, owner.password);
  await openUserMenu(page);
  await page.getByRole("menuitem", { name: "Notification preferences" }).click();
  await expect(page).toHaveURL(/\/users\/\d+\/notification-preferences/);

  // Turn off the in-app row for "someone requests feedback from me" and leave everything else,
  // including its own email channel and every other type, untouched.
  const inAppRequested = page.getByRole("switch", { name: "Someone requests feedback from me — In app" });
  await expect(inAppRequested).toBeChecked();
  await inAppRequested.click();
  await Promise.all([
    page.waitForResponse(
      (r) => /\/notification-preferences$/.test(r.url()) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
  await expect(page.getByText("Notification preferences saved")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await logout(page);

  // A second actor triggers both a request (the muted type) and a kudo (a type left on).
  await login(page, AAA_ONE);
  await gotoUserRow(page, owner.name);
  await clickAskForFeedback(page, owner.name);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/feedbacks") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Send request" }).click(),
  ]);

  await page.getByRole("link", { name: "Kudos" }).click();
  await expect(page).toHaveURL(/\/kudos$/);
  await page.getByRole("link", { name: "New kudo" }).click();
  await expect(page).toHaveURL(/\/kudos\/new/);
  await pickMultiSelectOptions(page, "Recipients", [owner.name]);
  await typeContent(page, uniqueText("Great work on the release, thank you"));
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/feedbacks") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Save & send" }).click(),
  ]);
  await logout(page);

  // Back on the owner's bell: wait for the kudo row first (proves the list has loaded), THEN
  // assert the muted request never shows — a negative count assertion before the list has
  // finished loading would pass vacuously.
  await login(page, owner.email, owner.password);
  const dialog = await openBell(page);
  await expect(notificationCard(dialog, "has been sent")).toBeVisible();
  await expect(dialog.getByText(/requested feedback about/)).toHaveCount(0);
});

test("the master email switch round-trips from notification preferences, and an admin edits another user's", async ({
  page,
  request,
}) => {
  const owner = await mintUser(request, "E2E Notif Master");

  await login(page, owner.email, owner.password);
  await openUserMenu(page);
  await page.getByRole("menuitem", { name: "Notification preferences" }).click();
  await expect(page).toHaveURL(/\/users\/\d+\/notification-preferences/);
  const master = page.getByRole("switch", { name: "Send me emails" });
  await expect(master).toBeChecked(); // the default: emails on

  await master.click();
  await Promise.all([
    page.waitForResponse(
      (r) => /\/email-notifications$/.test(r.url()) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
  await expect(page.getByText("Notification preferences saved")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await openUserMenu(page);
  await page.getByRole("menuitem", { name: "Notification preferences" }).click();
  await expect(master).not.toBeChecked();
  // The whole email column is greyed out (disabled) while the master switch is off.
  await expect(
    page.getByRole("switch", { name: "Someone requests feedback from me — Email" }),
  ).toBeDisabled();

  // …and back on.
  await master.click();
  await Promise.all([
    page.waitForResponse(
      (r) => /\/email-notifications$/.test(r.url()) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
  await expect(page.getByText("Notification preferences saved")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await logout(page);

  // The admin-for-another-user branch: the same screen opened by an ADMIN on someone else's id
  // saves the target's flag and returns to /users, not home.
  await login(page, ADMIN);
  await page.goto(`/users/${owner.id}/notification-preferences`);
  await expect(page.getByText(owner.email)).toBeVisible();
  await expect(master).toBeChecked();
  await master.click();
  await Promise.all([
    page.waitForResponse(
      (r) => /\/email-notifications$/.test(r.url()) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
  await expect(page.getByText("Notification preferences saved")).toBeVisible();
  await expect(page).toHaveURL(/\/users$/);
  await page.goto(`/users/${owner.id}/notification-preferences`);
  await expect(master).not.toBeChecked();
});
