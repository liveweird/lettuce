import {
  AAA_ONE,
  ADMIN,
  MANAGER_AAA,
  collapseAlertsBanner,
  expect,
  login,
  logout,
  recordApiWrites,
  test,
} from "./helpers";
import { apiToken, authHeader } from "./api";
import type { APIRequestContext, Page } from "@playwright/test";

// The "How performance reviews work" tutorial (v3.17.0) walked as a manager and as a
// non-manager, asserting the landmark order the script promises and the read-only invariant —
// nothing is created, changed or deleted. Reuses the guided tour's counter-loop idiom
// (tests/tour.spec.ts), same as feedback-tutorial.spec.ts / goals-tutorial.spec.ts /
// days-off-tutorial.spec.ts: the same custom tooltip, the same "Step N of M" counter, Next/Done
// by exact accessible name, and the recordApiWrites no-non-GET oracle (v3.16.2, shared via
// helpers.ts) — list totals aren't a safe before/after comparison here: the parallel
// performance-reviews.spec creates and mutates reviews as Manager AAA, so a total can move
// mid-walk through no fault of the tutorial.

const MANAGER_LANDMARKS = [
  "nothing is saved",
  "never skips Calibration",
  "My performance lists",
  "Under Filters you narrow",
  "five categories",
  "Team's performance shows",
  "Period picker",
  "Distribution",
  "widens the scope",
  "New review in their row",
  "Pick the team member",
  "Create saves an empty draft",
  "Submit for calibration once",
  "Done takes you back to Performance",
];

/**
 * The Team's-performance dashboard steps (7-10) render only while the review-period timeline is
 * non-empty. On the shared dev DB it never is — a no-op there. On a fresh database (the
 * dispatch-only CI stack) this appends exactly one period as ADMIN through the UI, the
 * performance-reviews.spec "Will add:" idiom, then logs out.
 */
async function ensureReviewPeriodExists(page: Page, request: APIRequestContext): Promise<void> {
  const token = await apiToken(request, ADMIN);
  const res = await request.get("/api/v1/review-periods?pageSize=1", { headers: authHeader(token) });
  const { items } = (await res.json()) as { items: unknown[] };
  if (items.length > 0) return;

  await login(page, ADMIN);
  await page.getByRole("button", { name: "Config" }).click();
  await page.getByRole("link", { name: "Review periods" }).click();
  await expect(page.getByRole("heading", { name: "Review periods" })).toBeVisible();
  await expect(page.getByText(/^Will add: /)).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/v1/review-periods") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Add period" }).click(),
  ]);
  await logout(page);
}

async function walkTutorial(page: Page): Promise<string[]> {
  await page.getByRole("button", { name: "How performance reviews work" }).click();
  const seen: string[] = [];
  for (let step = 1; step <= 20; step++) {
    const counter = page.getByText(new RegExp(`^Step ${step} of \\d+$`));
    await expect(counter).toBeVisible();
    // The custom tooltip is the innermost element wrapping the counter + content + buttons.
    const tooltip = page.locator("div").filter({ has: counter }).last();
    seen.push((await tooltip.innerText()).replace(/\s+/g, " "));
    const done = tooltip.getByRole("button", { name: "Done", exact: true });
    if (await done.isVisible().catch(() => false)) {
      await done.click();
      break;
    }
    await tooltip.getByRole("button", { name: "Next", exact: true }).click();
  }
  return seen;
}

function assertLandmarkOrder(seen: string[], landmarks: string[]) {
  // Each landmark appears, strictly after the previous one.
  let cursor = -1;
  for (const landmark of landmarks) {
    const at = seen.findIndex((text, i) => i > cursor && text.includes(landmark));
    expect(at, `landmark "${landmark}" after step ${cursor + 1}`).toBeGreaterThan(cursor);
    cursor = at;
  }
}

test("the performance reviews tutorial walks a manager through 14 read-only steps and returns to the Performance page", async ({
  page,
  request,
}) => {
  await ensureReviewPeriodExists(page, request);

  await login(page, MANAGER_AAA);
  await collapseAlertsBanner(page);
  await page.goto("/performance");

  const writes = recordApiWrites(page);

  const seen = await walkTutorial(page);

  expect(seen).toHaveLength(14);
  assertLandmarkOrder(seen, MANAGER_LANDMARKS);
  await expect(page).toHaveURL(/\/performance\?tab=own/);

  expect(writes).toEqual([]);
});

test("the performance reviews tutorial shows a non-manager 6 steps without the team steps", async ({ page }) => {
  await login(page, AAA_ONE);
  await collapseAlertsBanner(page);
  await page.goto("/performance");

  const writes = recordApiWrites(page);

  const seen = await walkTutorial(page);

  expect(seen).toHaveLength(6);
  for (const text of seen) {
    expect(text).not.toContain("Team's performance shows");
    expect(text).not.toContain("New review in their row");
    expect(text).not.toContain("Submit for calibration once");
  }
  await expect(page).toHaveURL(/\/performance\?tab=own/);
  expect(writes).toEqual([]);
});
