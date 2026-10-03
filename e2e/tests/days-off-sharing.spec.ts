import {
  test,
  expect,
  login,
  logout,
  createUserViaUi,
  fillDate,
  openBell,
  notificationCard,
  openFilters,
  pickMultiSelectOptions,
  rowByTitle,
  uniqueText,
  ADMIN,
} from "./helpers";
import { apiToken, authHeader } from "./api";
import type { APIRequestContext, Page } from "@playwright/test";

// Days-off calendar sharing (v4.11.0), end to end on a throwaway cast: a manager M with two reports
// R1 and R2 (one throwaway team) and a bystander X outside the reporting line. R1 and R2 each hold
// one PAID entry next month (booked by M on their behalf over the API). M shares R1's calendar with
// X from R1's row on the managed calendar; X follows the bell card to the "Shared with me" scope,
// sees R1's absence as plain "Paid" (the pool name redacted) under "Shared by M", and cannot read
// the entry itself. M then mass-shares both calendars from the team tab's "Share calendars…" page
// (R1 is reported as already shared, R2 is new); X gets ONE summary card and now lists both. R1 —
// the person, the author of every share of their calendar — withdraws M's share from their own row,
// and X's scope keeps only R2. Owns all its state: four throwaway users, one team, two days-off
// entries, two shares; nothing else in the suite touches them, and the residue sweep removes the
// users and the team (the entries, the two default-pool grants and the shares stay behind — inert, all
// owned by soft-deleted users). It never touches the public-holiday registry: a day a holiday made
// free of cost is refused by the server (400) and the next candidate is used.

/** `YYYY-MM-DD`, 30 days from now — a future end date that the server accepts at any time of day. */
function futureIso(): string {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function localIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Candidate working days in NEXT month (local), the 8th onward — Monday to Friday only. */
function nextMonthWeekdays(): string[] {
  const now = new Date();
  const days: string[] = [];
  for (let day = 8; day <= 24; day++) {
    const date = new Date(now.getFullYear(), now.getMonth() + 1, day);
    if (date.getDay() !== 0 && date.getDay() !== 6) days.push(localIso(date));
  }
  return days;
}

/**
 * Books one PAID day for [person] as [manager] over the API (the on-behalf right of a chain
 * manager, setup only) after granting the allowance. A candidate day that a parallel spec's public
 * holiday made free of cost is refused — the next candidate is tried.
 */
async function bookPaidDay(
  request: APIRequestContext,
  managerHeaders: { Authorization: string },
  person: { id: number },
  candidates: string[],
): Promise<{ id: number; date: string }> {
  const allowance = await request.put("/api/v1/days-off/allowance", {
    headers: managerHeaders,
    data: { userId: person.id, allowance: 20 },
  });
  expect(allowance.ok()).toBeTruthy();
  let last = "";
  for (const date of candidates) {
    const created = await request.post("/api/v1/days-off", {
      headers: managerHeaders,
      data: { type: "PAID", startDate: date, endDate: date, userId: person.id },
    });
    if (created.ok()) return { id: ((await created.json()) as { id: number }).id, date };
    last = `${created.status()} ${await created.text()}`;
    // Only the holiday case (a zero-cost day, 400) is worth another candidate; anything else is a real failure.
    if (created.status() !== 400) break;
  }
  throw new Error(`days-off-sharing: no candidate day accepted a PAID entry (last: ${last})`);
}

/** Opens the Calendar tab at [path] and steps to next month, where the entries live. */
async function openNextMonth(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.getByRole("button", { name: "Next month" }).click();
}

/** The calendar row (a table row) whose row header is [name]. */
function calendarRow(page: Page, name: string) {
  return page.getByRole("row").filter({ has: page.getByRole("rowheader", { name, exact: true }) });
}

test("a manager shares two reports' days-off calendars, the sharee sees them in Shared with me, and one share is withdrawn", async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);

  // Setup: four throwaway people (passwords from the one-time reveal modal), the throwaway team T
  // (manager M, members R1 + R2), the allowance + one PAID entry next month for each report.
  await login(page, ADMIN);
  const manager = await createUserViaUi(page, "E2E CalShare Manager");
  const report1 = await createUserViaUi(page, "E2E CalShare ReportOne");
  const report2 = await createUserViaUi(page, "E2E CalShare ReportTwo");
  const sharee = await createUserViaUi(page, "E2E CalShare Sharee");
  await logout(page);

  const adminHeaders = authHeader(await apiToken(request, ADMIN));
  const team = await request.post("/api/v1/teams", {
    headers: adminHeaders,
    data: {
      name: uniqueText("E2E CalShare Team"),
      managerId: manager.id,
      memberIds: [report1.id, report2.id],
    },
  });
  expect(team.ok()).toBeTruthy();
  const teamName = ((await team.json()) as { name: string }).name;

  const managerHeaders = authHeader(await apiToken(request, manager.email, manager.password));
  const candidates = nextMonthWeekdays();
  const entry1 = await bookPaidDay(request, managerHeaders, report1, candidates);
  const entry2 = await bookPaidDay(request, managerHeaders, report2, candidates);
  // `${name} — ${date}: Paid (1 day)` — the cell description a sharee sees: no pool name.
  const redactedTitle = (name: string, date: string) => `${name} — ${date}: Paid (1 day)`;

  // 1. M opens the calendar on "My direct reports", steps to next month and shares R1's calendar.
  await login(page, manager.email, manager.password);
  await openNextMonth(page, "/days-off?tab=calendar");
  await page.getByRole("combobox", { name: "Whose calendar" }).click();
  await page.getByRole("option", { name: "My direct reports", exact: true }).click();
  await expect(calendarRow(page, report1.name)).toBeVisible();
  // A chain manager sees the pool's own name on the cell (the contrast to X's redacted view below).
  await expect(
    page.getByTitle(`${report1.name} — ${entry1.date}: Paid days off (1 day)`, { exact: true }),
  ).toBeVisible();
  await calendarRow(page, report1.name)
    .getByRole("button", { name: `Share the days-off calendar of ${report1.name}` })
    .click();
  const dialog = page.getByRole("dialog", { name: "Share this calendar" });
  await expect(dialog).toBeVisible();
  await pickMultiSelectOptions(page, "Share with", [sharee.name]);
  await fillDate(dialog, "Until", futureIso());
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/shares") && r.request().method() === "POST" && r.ok(),
    ),
    dialog.getByRole("button", { name: "Share", exact: true }).click(),
  ]);
  await expect(page.getByText("Calendar shared")).toBeVisible();
  await expect(dialog.getByText("Active", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await logout(page);

  // 2. X: the bell card names M and R1; following it opens the calendar on "Shared with me" with
  // R1's row highlighted — "Shared by M", the absence described as plain "Paid".
  await login(page, sharee.email, sharee.password);
  const bell = await openBell(page);
  const singleCard = notificationCard(
    bell,
    `${manager.name} shared ${report1.name}'s days-off calendar with you.`,
  );
  await expect(singleCard).toBeVisible();
  await singleCard.getByRole("button", { name: /^Go to notification \d+$/ }).click();
  await expect(page).toHaveURL(/\/days-off\?tab=calendar&scope=shared&user=\d+/);
  await expect(page.getByRole("combobox", { name: "Whose calendar" })).toHaveValue("Shared with me");
  const row1 = calendarRow(page, report1.name);
  await expect(row1).toBeVisible();
  await expect(page.getByRole("rowheader", { name: report1.name, exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(row1.getByText(`Shared by ${manager.name}`)).toBeVisible();
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.getByTitle(redactedTitle(report1.name, entry1.date), { exact: true })).toBeVisible();
  // Teammate parity: the pool's own name never reaches the sharee, and R2 is not in the scope yet.
  await expect(page.locator('[title*="Paid days off"]')).toHaveCount(0);
  await expect(calendarRow(page, report2.name)).toHaveCount(0);
  // X may not read the entry itself, and no row of the scope offers X a Share action.
  const shareeHeaders = authHeader(await apiToken(request, sharee.email, sharee.password));
  const entryRead = await request.get(`/api/v1/days-off/${entry1.id}`, { headers: shareeHeaders });
  expect(entryRead.status()).toBe(403);
  await expect(page.getByRole("button", { name: /^Share the days-off calendar of / })).toHaveCount(0);
  // The Shared screen lists the calendar share under its frozen label.
  await page.goto("/shares");
  await expect(page.getByRole("heading", { level: 2, name: "Shared" })).toBeVisible();
  await expect(rowByTitle(page, `Days-off calendar of ${report1.name}`)).toBeVisible();
  await logout(page);

  // 3. M: team tab → "Share calendars…" → narrow by the team → Select all matching → share with X.
  await login(page, manager.email, manager.password);
  await page.goto("/days-off?tab=team");
  await page.getByRole("link", { name: "Share calendars…" }).click();
  await expect(page).toHaveURL(/\/days-off\/mass-share$/);
  await expect(page.getByRole("heading", { name: "Share days-off calendars" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: `Select ${report1.name}` })).toBeEnabled();
  await expect(page.getByRole("checkbox", { name: `Select ${report2.name}` })).toBeEnabled();
  await openFilters(page);
  await pickMultiSelectOptions(page, "Teams", [teamName]);
  await page.getByRole("button", { name: "Select all matching (2)" }).click();
  await expect(page.getByRole("checkbox", { name: `Select ${report1.name}` })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: `Select ${report2.name}` })).toBeChecked();
  await page.getByRole("button", { name: "Share 2 calendars…" }).click();
  const massDialog = page.getByRole("dialog", { name: "Share days-off calendars" });
  await expect(massDialog).toBeVisible();
  await pickMultiSelectOptions(page, "Share with", [sharee.name]);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/shares/batch") && r.request().method() === "POST" && r.ok(),
    ),
    massDialog.getByRole("button", { name: "Share", exact: true }).click(),
  ]);
  await expect(page.getByText("Calendars shared")).toBeVisible();
  // R2 is new; R1 was already shared with X by the single share above and is left unchanged.
  await expect(massDialog.getByText("New shares: 1")).toBeVisible();
  await expect(massDialog.getByText("Already shared. Left unchanged, including their end date:")).toBeVisible();
  await expect(massDialog.getByText(`${report1.name}: already shared with ${sharee.name}`)).toBeVisible();
  await page.keyboard.press("Escape");
  await logout(page);

  // 4. X: ONE summary card for the batch (no per-calendar card for R2); the shared scope lists both.
  await login(page, sharee.email, sharee.password);
  const bell2 = await openBell(page);
  const batchCard = notificationCard(bell2, `${manager.name} shared 1 days-off calendar with you.`);
  await expect(batchCard).toBeVisible();
  await expect(
    bell2.getByRole("listitem").filter({ hasText: `${manager.name} shared 1 days-off calendar with you.` }),
  ).toHaveCount(1);
  await expect(bell2.getByText(`shared ${report2.name}'s days-off calendar`)).toHaveCount(0);
  await batchCard.getByRole("button", { name: /^Go to notification \d+$/ }).click();
  await expect(page).toHaveURL(/\/days-off\?tab=calendar&scope=shared$/);
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(calendarRow(page, report1.name)).toBeVisible();
  await expect(calendarRow(page, report2.name)).toBeVisible();
  await expect(page.getByTitle(redactedTitle(report2.name, entry2.date), { exact: true })).toBeVisible();
  await logout(page);

  // 5. R1 — the person, hence the author of every share of their calendar — opens their own row's
  // Share dialog on "My teams", sees M's share in the current shares and withdraws it.
  await login(page, report1.email, report1.password);
  await page.goto("/days-off?tab=calendar");
  await page.getByRole("button", { name: "Share my days-off calendar" }).click();
  const ownDialog = page.getByRole("dialog", { name: "Share this calendar" });
  await expect(ownDialog).toBeVisible();
  await expect(ownDialog.getByText(`Shared by ${manager.name}`)).toBeVisible();
  await ownDialog.getByRole("button", { name: `Withdraw the share with ${sharee.name}` }).click();
  await expect(page.getByText("Withdraw this share?")).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/v1\/shares\/\d+\/withdraw$/.test(r.url()) && r.request().method() === "POST" && r.ok(),
    ),
    page
      .getByRole("dialog", { name: "Withdraw this share?" })
      .getByRole("button", { name: "Withdraw", exact: true })
      .click(),
  ]);
  await expect(page.getByText("Share withdrawn")).toBeVisible();
  await expect(ownDialog.getByText("Withdrawn", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await logout(page);

  // 6. X's shared scope keeps only R2.
  await login(page, sharee.email, sharee.password);
  await openNextMonth(page, "/days-off?tab=calendar&scope=shared");
  await expect(calendarRow(page, report2.name)).toBeVisible();
  await expect(calendarRow(page, report1.name)).toHaveCount(0);
});
