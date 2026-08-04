import {
  test,
  expect,
  login,
  logout,
  createUserViaUi,
  notificationCard,
  openBell,
  openFilters,
  pickSelectOption,
  uniqueText,
  ADMIN,
  MANAGER_AAA,
} from "./helpers";
import type { Page } from "@playwright/test";

// The performance-review journey end to end: the admin appends a review period (timeline
// coverage — the fresh period is FUTURE now that the dev timeline extends past today, and a
// review may only be created for a STARTED period since v1.34.2), creates a throwaway
// subordinate + team under Manager AAA (a fresh subordinate per run keeps the
// (subordinate, CURRENT period) slot new — the old fresh-period trick can't be used for
// creation anymore), the manager fills and publishes a review for the CURRENT period from the
// Dashboard's Performance-reviews tab, the subordinate sees it (bell + the My performance
// list, read-only), and an unpublish takes it back to calibration. The published record
// deliberately persists in the dev volume — a CALIBRATION leftover blocks nothing, since the
// next run reviews a fresh subordinate.

const CATEGORIES = ["Attitude", "Delivery", "Skills", "Overall"] as const;
const RATING = "4 — Sometimes exceeds expectations";
// On the view screen the rating renders as a colored badge + the wording beside it (v1.33.1).
const RATING_WORDING = "Sometimes exceeds expectations";

async function pickRating(page: Page, label: string) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: RATING }).click();
}

test("a performance review travels period → draft → calibration → published → subordinate", async ({ page }) => {
  // 1. The admin appends a fresh period (Config → Review periods). The pickers default to a
  //    valid period (fixed/current start + 6 months) and the append form only renders once
  //    the timeline data is loaded, so the preview line names the EXACT range Add will create
  //    — read the label from it instead of computing months (v1.33.2, dropdown entry).
  await login(page, ADMIN);
  await page.getByRole("button", { name: "Config" }).click();
  await page.getByRole("link", { name: "Review periods" }).click();
  await expect(page.getByRole("heading", { name: "Review periods" })).toBeVisible();
  const preview = page.getByText(/^Will add: /);
  await expect(preview).toBeVisible();
  const periodLabel = (await preview.innerText()).replace(/^Will add: /, "");
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/v1/review-periods") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Add period" }).click(),
  ]);
  // The new period lands in the timeline list.
  await expect(page.getByText(periodLabel, { exact: true })).toBeVisible();

  // The CURRENT period (the row carrying the "Current" badge — v1.34.0) is the only one a
  // review can be created for; read its range off the innermost group that holds BOTH the
  // badge and the range text (the badge's own root div holds no <p> and must not match).
  const currentRowGroup = page
    .locator("div")
    .filter({ has: page.getByText("Current", { exact: true }) })
    .filter({ has: page.locator("p") })
    .last();
  const currentPeriodLabel = (await currentRowGroup.locator("p").first().innerText()).trim();

  // On a fresh volume the period just appended IS the very first one and defaults to starting
  // this month — i.e. it's the CURRENT period, and no future period exists yet for the
  // disabled-option assertion below. Append one more (adjacent, so guaranteed future) in that
  // case; on any grown timeline the first append is already future and this branch is skipped.
  let futurePeriodLabel = periodLabel;
  if (futurePeriodLabel === currentPeriodLabel) {
    const nextPreview = page.getByText(/^Will add: /);
    await expect(nextPreview).toBeVisible();
    futurePeriodLabel = (await nextPreview.innerText()).replace(/^Will add: /, "");
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/v1/review-periods") && r.request().method() === "POST" && r.ok(),
      ),
      page.getByRole("button", { name: "Add period" }).click(),
    ]);
    await expect(page.getByText(futurePeriodLabel, { exact: true })).toBeVisible();
  }

  // 1b. A throwaway subordinate + team under Manager AAA: a fresh person per run keeps the
  //     (subordinate, current period) review slot unoccupied however often the suite reruns.
  const reviewee = await createUserViaUi(page, "E2E Reviewee");
  const teamName = uniqueText("E2E Review Team");
  await page.goto("/teams/new");
  await page.getByRole("textbox", { name: "Name" }).fill(teamName);
  await pickSelectOption(page, "Manager", "Manager AAA");
  const [teamCreated] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/teams") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Create" }).click(),
  ]);
  const teamId: number = (await teamCreated.json()).id;
  await page.goto(`/teams/${teamId}/members`);
  await pickSelectOption(page, "Add a user", reviewee.name);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/teams/${teamId}/members/`) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Add", exact: true }).click(),
  ]);
  await logout(page);

  // 2. The manager's Dashboard tab: scope to the current period (the default is the latest =
  //    the future one) and the throwaway team (accumulated E2E rows would push the reviewee
  //    off page 1 on the name sort), then New review lands in the create screen with the
  //    subordinate locked and the CURRENT period preselected — the newest STARTED period is
  //    the default now, never the future one.
  await login(page, MANAGER_AAA);
  await page.goto("/?tab=reviews");
  // The Period and Team Selects are non-searchable (readonly inputs) — click + pick, not
  // pickSelectOption (whose fill() would fail on a readonly combobox).
  await page.getByRole("combobox", { name: "Period" }).click();
  await page.getByRole("option", { name: currentPeriodLabel }).click();
  await openFilters(page);
  await page.getByRole("combobox", { name: "Team" }).click();
  await page.getByRole("option", { name: teamName }).click();
  const annRow = page.getByRole("row").filter({ hasText: reviewee.name });
  await expect(annRow.getByText("No review yet")).toBeVisible();
  await annRow.getByRole("link", { name: `New performance review for ${reviewee.name}` }).click();
  await expect(page.getByRole("heading", { name: "New review" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Period" })).toHaveValue(currentPeriodLabel);
  // The fresh (future) period is offered but disabled — the server would 400 it.
  await page.getByRole("combobox", { name: "Period" }).click();
  await expect(page.getByRole("option", { name: futurePeriodLabel })).toHaveAttribute(
    "data-combobox-disabled",
  );
  await page.keyboard.press("Escape");
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
  await annRow.getByRole("link", { name: `View the performance review of ${reviewee.name}` }).click();
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
  await login(page, reviewee.email, reviewee.password);
  const bell = await openBell(page);
  await expect(bell.getByText("Notifications")).toBeVisible();
  await expect(notificationCard(bell, "published your performance review")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "My performance" }).click();
  const myRow = page.getByRole("row").filter({ hasText: currentPeriodLabel });
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
