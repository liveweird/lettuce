import {
  AAA_TWO,
  ADMIN,
  collapseAlertsBanner,
  expect,
  gotoUserRow,
  login,
  logout,
  MANAGER_AAA,
  notificationCard,
  openBell,
  test,
} from "./helpers";
import type { Page } from "@playwright/test";

// Days off end to end: the admin curates a public holiday and an allowance, AAA Two requests
// two periods, Manager AAA accepts one and rejects the other, the accepted days show on the
// team calendar, and the accepted (future) request is cancelled again — so seeded accounts are
// never left with counting requests (REJECTED/CANCELLED rows are inert records).
//
// The request window is a run-specific future Monday (weeks vary per run), so residue from a
// failed earlier run never collides via the overlap rule.

function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** A future Monday 4–43 weeks out (varies per run-minute); the whole two-week window the spec
 * books must stay inside one calendar year (the same-year rule). */
function pickMonday(): Date {
  let monday = new Date();
  monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7)); // next Monday
  const weeks = 4 + (Math.floor(Date.now() / 60_000) % 40);
  monday = addDays(monday, weeks * 7);
  while (monday.getFullYear() !== addDays(monday, 8).getFullYear()) {
    monday = addDays(monday, 7);
  }
  return monday;
}

const MONDAY = pickMonday();
const MONDAY_ISO = isoDate(MONDAY);
const TUESDAY_ISO = isoDate(addDays(MONDAY, 1));
const MONDAY2_ISO = isoDate(addDays(MONDAY, 7));
const TUESDAY2_ISO = isoDate(addDays(MONDAY, 8));

// How the calendar cell describes the accepted Tuesday (the raw ISO date rides the title).
const TUESDAY_CELL_TITLE = `AAA Two — ${TUESDAY_ISO}: Paid, Accepted (1 day)`;

async function newRequest(page: Page, from: string, to: string, expectedCost: string) {
  await page.getByRole("link", { name: "New request" }).click();
  await expect(page).toHaveURL(/\/days-off\/new/);
  await page.getByLabel("From", { exact: true }).fill(from);
  await page.getByLabel("To", { exact: true }).fill(to);
  await expect(page.getByText(`This request costs ${expectedCost} working day(s).`)).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/days-off") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Submit request" }).click(),
  ]);
  await expect(page).toHaveURL(/\/days-off\?tab=requests/);
}

test("days off end to end: holiday, allowance, request, resolve, calendar, cancel", async ({ page }) => {
  test.setTimeout(180_000);

  // ── Admin: a public holiday on the Monday + a generous allowance for AAA Two. ──
  await login(page, ADMIN);
  await collapseAlertsBanner(page);
  await page.goto("/public-holidays");
  await page.getByLabel("Date", { exact: true }).fill(MONDAY_ISO);
  await page.getByLabel("Name", { exact: true }).fill(`E2E Holiday ${MONDAY_ISO}`);
  await page.getByRole("button", { name: "Add holiday" }).click();
  // A residual holiday from a failed run answers 409 — either way the date is now covered.
  await expect(
    page
      .getByText("Public holiday added")
      .or(page.getByText("A holiday already exists on this date.")),
  ).toBeVisible();
  await expect(page.getByText(`E2E Holiday ${MONDAY_ISO}`).first()).toBeVisible();

  await gotoUserRow(page, "AAA Two");
  await page.getByLabel("Edit AAA Two").click();
  await expect(page).toHaveURL(/\/users\/\d+\/edit/);
  await page.getByLabel("Paid days-off allowance (days per year)").fill("300");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/users$/);
  await logout(page);

  // ── AAA Two: two requests — Mon(holiday)+Tue = 1 day, next Mon+Tue = 2 days. ──
  await login(page, AAA_TWO);
  await collapseAlertsBanner(page);
  await page.goto("/days-off?tab=requests");
  await expect(page.getByText(/Your paid days off in \d{4}/)).toBeVisible();
  await newRequest(page, MONDAY_ISO, TUESDAY_ISO, "1");
  await expect(page.getByText("Days-off request submitted")).toBeVisible();
  await newRequest(page, MONDAY2_ISO, TUESDAY2_ISO, "2");
  // Both rows sit in My requests as pending.
  await expect(page.locator("tr", { hasText: "Requested" }).first()).toBeVisible();
  await logout(page);

  // ── Manager AAA: the bell heard about it; accept one, reject the other. ──
  await login(page, MANAGER_AAA);
  const dialog = await openBell(page);
  await expect(notificationCard(dialog, "AAA Two requested time off")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/days-off?tab=team");
  await page
    .getByLabel(`Accept the days-off request of AAA Two starting ${MONDAY_ISO}`)
    .click();
  await expect(page.getByText("Request accepted")).toBeVisible();
  await page
    .getByLabel(`Reject the days-off request of AAA Two starting ${MONDAY2_ISO}`)
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByText("Request rejected")).toBeVisible();
  await logout(page);

  // ── AAA Two: sees the outcomes, the calendar bar, then cancels the accepted request. ──
  await login(page, AAA_TWO);
  await collapseAlertsBanner(page);
  const ownBell = await openBell(page);
  await expect(
    notificationCard(ownBell, "Manager AAA accepted your days-off request"),
  ).toBeVisible();
  await expect(
    notificationCard(ownBell, "Manager AAA rejected your days-off request"),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/days-off?tab=requests");
  await expect(page.locator("tr", { hasText: "Accepted" }).first()).toBeVisible();
  await expect(page.locator("tr", { hasText: "Rejected" }).first()).toBeVisible();

  // Page the calendar forward to the request's month and find the accepted Tuesday's bar.
  await page.getByRole("tab", { name: "Calendar" }).click();
  await expect(page.getByRole("table", { name: "Team days-off calendar" })).toBeVisible();
  const now = new Date();
  const monthSteps =
    (MONDAY.getFullYear() - now.getFullYear()) * 12 + (MONDAY.getMonth() - now.getMonth());
  for (let i = 0; i < monthSteps; i += 1) {
    await page.getByLabel("Next month").click();
  }
  await expect(page.locator(`[title="${TUESDAY_CELL_TITLE}"]`)).toBeVisible();

  // Cancel the accepted (still future) request — the reserved days return to the budget.
  await page.goto("/days-off?tab=requests");
  await page.getByLabel(`Cancel your days-off request starting ${MONDAY_ISO}`).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel the request", exact: true })
    .click();
  await expect(page.getByText("Request cancelled")).toBeVisible();
  await logout(page);

  // ── Cleanup: the manager hears about the cancellation; the admin removes the holiday. ──
  await login(page, ADMIN);
  await collapseAlertsBanner(page);
  await page.goto("/public-holidays");
  const holidayRow = page
    .locator("div.mantine-Paper-root", { hasText: `E2E Holiday ${MONDAY_ISO}` })
    .last();
  await holidayRow.getByRole("button", { name: /^Delete the holiday/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Public holiday deleted")).toBeVisible();
  await logout(page);
});
