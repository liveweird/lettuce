import {
  test,
  expect,
  login,
  logout,
  notificationCard,
  openBell,
  AAA_ONE,
  ADMIN,
  MANAGER_AAA,
} from "./helpers";
import type { Page } from "@playwright/test";

// The performance-review journey end to end: the admin appends a review period (the timeline is
// global and append-only — each run creates its OWN fresh period, so re-runs stack safely and
// every run's (subordinate, period) slot is new), the manager fills and publishes a review for
// AAA One from the Dashboard's Performance-reviews tab, the subordinate sees it (bell + the My
// performance list, read-only), and an unpublish takes it back to calibration. The published
// record deliberately persists in the dev volume (like sent feedback) — a CALIBRATION leftover
// blocks nothing, since the next run uses a new period.

const CATEGORIES = ["Attitude", "Delivery", "Skills", "Overall"] as const;
const RATING = "4 — Sometimes exceeds expectations";
// On the view screen the rating renders as a colored badge + the wording beside it (v1.33.1).
const RATING_WORDING = "Sometimes exceeds expectations";

function addMonths(month: string, months: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(
    new Date(y, m - 1, 1),
  );
}

async function pickRating(page: Page, label: string) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: RATING }).click();
}

test("a performance review travels period → draft → calibration → published → subordinate", async ({ page }) => {
  // 1. The admin appends a fresh period (Config → Review periods). The start input is locked
  //    to the adjacent month once any period exists; on a virgin timeline it is free.
  await login(page, ADMIN);
  await page.getByRole("button", { name: "Config" }).click();
  await page.getByRole("link", { name: "Review periods" }).click();
  await expect(page.getByRole("heading", { name: "Review periods" })).toBeVisible();
  // Wait for the timeline data before reading the start input (the dictionaries lesson: the
  // form renders before the query resolves; reading too early sees the pre-lock empty value
  // and computes a non-adjacent end, leaving Add disabled forever). Loaded = either the empty
  // state or at least one period row's Delete affordance.
  await expect(
    page
      .getByText("No review periods yet — add the first one below.")
      .or(page.getByRole("button", { name: /^Delete the period/ }))
      .first(),
  ).toBeVisible();
  const startInput = page.getByLabel("First month");
  let start = await startInput.inputValue();
  if (start === "") {
    start = "2000-01";
    await startInput.fill(start);
  }
  const end = addMonths(start, 5);
  const periodLabel = `${monthLabel(start)} – ${monthLabel(end)}`;
  await page.getByLabel("Last month").fill(end);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/v1/review-periods") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Add period" }).click(),
  ]);
  await expect(page.getByText(periodLabel)).toBeVisible();
  await logout(page);

  // 2. The manager's Dashboard tab shows AAA One with no review yet; New review lands in the
  //    create screen with the subordinate locked and OUR (latest) period preselected.
  await login(page, MANAGER_AAA);
  await page.goto("/?tab=reviews");
  const annRow = page.getByRole("row").filter({ hasText: "AAA One" });
  await expect(annRow.getByText("No review yet")).toBeVisible();
  await annRow.getByRole("link", { name: "New performance review for AAA One" }).click();
  await expect(page.getByRole("heading", { name: "New review" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Period" })).toHaveValue(periodLabel);
  const [createResponse] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/v1/performance-reviews") &&
        r.request().method() === "POST" &&
        r.ok(),
    ),
    page.getByRole("button", { name: "Create", exact: true }).click(),
  ]);
  const reviewId = ((await createResponse.json()) as { id: number }).id;

  // 3. The editor opens directly; fill all four categories and Save & submit → calibration.
  await expect(page.getByRole("heading", { name: "Edit performance review" })).toBeVisible();
  for (const [index, category] of CATEGORIES.entries()) {
    await pickRating(page, category);
    await page
      .getByLabel("Summary")
      .nth(index)
      .fill(`E2E ${category.toLowerCase()} summary for this period.`);
  }
  await page.getByRole("button", { name: "Save & submit" }).click();
  await expect(page).toHaveURL(/\?tab=reviews/);
  await expect(annRow.getByText("Calibration")).toBeVisible();

  // 4. The CALIBRATION row opens the view screen, which owns Publish.
  await annRow.getByRole("link", { name: "View the performance review of AAA One" }).click();
  await expect(page.getByText(RATING_WORDING).first()).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/api/v1/performance-reviews/${reviewId}/publish`) && r.ok(),
    ),
    page.getByRole("button", { name: "Publish" }).click(),
  ]);
  await expect(annRow.getByText("Published")).toBeVisible();
  await logout(page);

  // 5. The subordinate: bell notification + the review in My performance, read-only.
  await login(page, AAA_ONE);
  const bell = await openBell(page);
  await expect(bell.getByText("Notifications")).toBeVisible();
  await expect(notificationCard(bell, "published your performance review")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "My performance" }).click();
  const myRow = page.getByRole("row").filter({ hasText: periodLabel });
  await expect(myRow.getByText("Published")).toBeVisible();
  await myRow.getByRole("link", { name: /^View the performance review/ }).click();
  await expect(page.getByText(RATING_WORDING).first()).toBeVisible();
  await expect(page.getByText("E2E attitude summary for this period.")).toBeVisible();
  // Read-only: no lifecycle or edit affordances for the subordinate.
  await expect(page.getByRole("button", { name: "Unpublish" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  await logout(page);

  // 6. The manager retracts it — the review returns to calibration on the dashboard.
  await login(page, MANAGER_AAA);
  await page.goto(`/performance-reviews/${reviewId}/view?back=%2F%3Ftab%3Dreviews`);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/api/v1/performance-reviews/${reviewId}/unpublish`) && r.ok(),
    ),
    page.getByRole("button", { name: "Unpublish" }).click(),
  ]);
  await expect(page).toHaveURL(/\?tab=reviews/);
  await expect(annRow.getByText("Calibration")).toBeVisible();
});
