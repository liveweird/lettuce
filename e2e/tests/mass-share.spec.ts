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
import type { APIRequestContext } from "@playwright/test";

// Mass sharing of performance reviews (v4.10.0), end to end on a throwaway cast: a manager M with
// two reports R1 and R2 (one throwaway team) holds a DRAFT review of each for the CURRENT period,
// and shares both with a bystander X in one go from the Team's-performance "Share reviews…" page —
// filter by team, "Select all matching", recipient + end date, the dialog's result line. X gets ONE
// summary bell card, lands on the Shared screen with two Active rows, opens one read-only; M
// withdraws that one from the review's own Share dialog and X's Active-filtered list shrinks to the
// other. Owns all its state: four throwaway users, one team, two reviews, two shares; nothing else
// in the suite touches them, and the residue sweep removes the users and the team. The one global
// registry it reads is the review-period timeline (owned by performance-reviews.spec): it only
// ever WRITES to it when the timeline is completely empty (a fresh database), the same one-off
// precondition performance-reviews-tutorial.spec applies.

/** `YYYY-MM-DD`, 30 days from now — a future end date that the server accepts at any time of day. */
function futureIso(): string {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

type Period = { id: number; startMonth: string; endMonth: string };

/** `YYYY-MM` plus [months]. */
function addMonths(month: string, months: number): string {
  const [year, mon] = month.split("-").map(Number);
  const total = year * 12 + (mon - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/**
 * The review period containing today — the only one a review can be created for. A completely
 * empty timeline (fresh database) gets one period appended as ADMIN over the API; any other
 * timeline is left alone.
 */
async function currentPeriodId(request: APIRequestContext): Promise<number> {
  const adminHeaders = authHeader(await apiToken(request, ADMIN));
  const month = new Date().toISOString().slice(0, 7);
  const list = await request.get("/api/v1/review-periods", { headers: adminHeaders });
  expect(list.ok()).toBeTruthy();
  const { items } = (await list.json()) as { items: Period[] };
  if (items.length === 0) {
    const created = await request.post("/api/v1/review-periods", {
      headers: adminHeaders,
      data: { startMonth: month, endMonth: addMonths(month, 5) },
    });
    expect(created.ok()).toBeTruthy();
    return ((await created.json()) as Period).id;
  }
  const current = items.find((p) => p.startMonth <= month && month <= p.endMonth);
  if (!current) throw new Error(`mass-share: no review period contains ${month}`);
  return current.id;
}

test("a manager shares two team reviews in one go, the sharee reads them read-only, and one share is withdrawn", async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);

  // Setup: four throwaway people (passwords from the one-time reveal modal), the throwaway team
  // T (manager M, members R1 + R2) and M's two DRAFT reviews for the current period over the API
  // (setup only — the journey under test starts at the Team's-performance page).
  await login(page, ADMIN);
  const manager = await createUserViaUi(page, "E2E MassShare Manager");
  const report1 = await createUserViaUi(page, "E2E MassShare ReportOne");
  const report2 = await createUserViaUi(page, "E2E MassShare ReportTwo");
  const sharee = await createUserViaUi(page, "E2E MassShare Sharee");
  await logout(page);

  const adminHeaders = authHeader(await apiToken(request, ADMIN));
  const teamName = uniqueText("E2E MassShare Team");
  const team = await request.post("/api/v1/teams", {
    headers: adminHeaders,
    data: { name: teamName, managerId: manager.id, memberIds: [report1.id, report2.id] },
  });
  expect(team.ok()).toBeTruthy();

  const periodId = await currentPeriodId(request);
  const managerHeaders = authHeader(await apiToken(request, manager.email, manager.password));
  const reviewIds: Record<string, number> = {};
  for (const report of [report1, report2]) {
    const created = await request.post("/api/v1/performance-reviews", {
      headers: managerHeaders,
      data: { subordinateId: report.id, periodId },
    });
    expect(created.ok()).toBeTruthy();
    reviewIds[report.name] = ((await created.json()) as { id: number }).id;
  }

  // 1. M opens Team's performance on the current period and follows "Share reviews…".
  await login(page, manager.email, manager.password);
  await page.goto("/performance?tab=managed");
  await page.getByRole("combobox", { name: "Period" }).click();
  await page.getByRole("option").filter({ hasText: "Current" }).click();
  await page.getByRole("link", { name: "Share reviews…" }).click();
  await expect(page).toHaveURL(new RegExp(`/performance-reviews/mass-share\\?periodId=${periodId}$`));
  await expect(page.getByRole("heading", { name: "Share performance reviews" })).toBeVisible();

  // 2. Both reports are listed and shareable; narrow by the team, then "Select all matching".
  await expect(page.getByRole("checkbox", { name: `Select ${report1.name}` })).toBeEnabled();
  await expect(page.getByRole("checkbox", { name: `Select ${report2.name}` })).toBeEnabled();
  await openFilters(page);
  await pickMultiSelectOptions(page, "Teams", [teamName]);
  await page.getByRole("button", { name: "Select all matching (2)" }).click();
  await expect(page.getByRole("checkbox", { name: `Select ${report1.name}` })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: `Select ${report2.name}` })).toBeChecked();

  // 3. The dialog: X as the recipient, an end date 30 days ahead; the result line counts both.
  await page.getByRole("button", { name: "Share 2 reviews…" }).click();
  const dialog = page.getByRole("dialog", { name: "Share performance reviews" });
  await expect(dialog).toBeVisible();
  await pickMultiSelectOptions(page, "Share with", [sharee.name]);
  await fillDate(dialog, "Until", futureIso());
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/shares/batch") && r.request().method() === "POST" && r.ok(),
    ),
    dialog.getByRole("button", { name: "Share", exact: true }).click(),
  ]);
  await expect(page.getByText("Reviews shared")).toBeVisible();
  await expect(dialog.getByText("New shares: 2")).toBeVisible();
  await page.keyboard.press("Escape");
  await logout(page);

  // 4. X: ONE summary card in the bell; following it opens the Shared screen with two Active rows.
  await login(page, sharee.email, sharee.password);
  const bell = await openBell(page);
  const card = notificationCard(bell, `${manager.name} shared 2 performance reviews with you.`);
  await expect(card).toBeVisible();
  // ONE summary for the whole batch (X is a throwaway, so the bell holds nothing else): exactly one
  // card from M, and no per-review "shared a performance review with you" card.
  await expect(bell.getByRole("listitem").filter({ hasText: `${manager.name} shared` })).toHaveCount(1);
  await expect(bell.getByText("shared a performance review with you")).toHaveCount(0);
  await card.getByRole("button", { name: /^Go to notification \d+$/ }).click();
  await expect(page).toHaveURL(/\/shares/);
  await expect(page.getByRole("heading", { level: 2, name: "Shared" })).toBeVisible();
  const row1 = rowByTitle(page, `${report1.name}, `);
  const row2 = rowByTitle(page, `${report2.name}, `);
  await expect(row1).toBeVisible();
  await expect(row2).toBeVisible();
  await expect(row1.getByText("Active", { exact: true })).toBeVisible();
  await expect(row2.getByText("Active", { exact: true })).toBeVisible();
  await expect(row1.getByText(manager.name).first()).toBeVisible();

  // 5. X opens the first review: read-only, with the sharer's banner and no Share button.
  await page.getByRole("link", { name: `Open the shared document: ${report1.name}, ` }).click();
  await expect(page).toHaveURL(new RegExp(`/performance-reviews/${reviewIds[report1.name]}/view`));
  await expect(page.getByText(`Shared with you by ${manager.name}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
  // Nor any author action: no Edit link, no lifecycle button; only Close leads out.
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  for (const action of ["Submit for calibration", "Return to draft", "Publish", "Unpublish"]) {
    await expect(page.getByRole("button", { name: action, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole("link", { name: "Close" })).toBeVisible();
  await logout(page);

  // 6. M withdraws the first review's share from that review's own Share dialog.
  await login(page, manager.email, manager.password);
  await page.goto(`/performance-reviews/${reviewIds[report1.name]}/view`);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Share this document" })).toBeVisible();
  await page.getByRole("button", { name: `Withdraw the share with ${sharee.name}` }).click();
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
  await expect(
    page.getByRole("dialog", { name: "Share this document" }).getByText("Withdrawn", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await logout(page);

  // 7. X's Shared screen, filtered to Active, keeps only the second review.
  await login(page, sharee.email, sharee.password);
  await page.goto("/shares");
  await openFilters(page);
  // The Shared screen's Status filter is a MultiSelect since v4.13.0 (any-of).
  await pickMultiSelectOptions(page, "Status", ["Active"]);
  await expect(rowByTitle(page, `${report2.name}, `)).toBeVisible();
  await expect(rowByTitle(page, `${report1.name}, `)).toHaveCount(0);
});
