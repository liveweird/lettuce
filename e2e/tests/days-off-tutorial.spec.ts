import { AAA_ONE, MANAGER_AAA, collapseAlertsBanner, expect, login, test } from "./helpers";
import type { APIRequestContext, Page } from "@playwright/test";

// The "How days off work" tutorial (v3.16.0) walked as a manager and as a non-manager, asserting
// the landmark order the script promises and the read-only invariant — nothing is recorded or
// deleted, so the caller's OWN days-off total must be unchanged before vs. after the walk.
// Only `view=own` is compared: the parallel `days-off.spec.ts` writes AAA Two's entries
// concurrently, and those rows ride Manager AAA's `view=managed` list, so a `managed` total would
// be an unrelated-state race rather than a signal about this walk. Nobody writes Manager AAA's or
// AAA One's own rows, so `view=own` stays a safe invariant under parallel workers.
// Reuses the guided tour's counter-loop idiom (tests/tour.spec.ts), same as
// feedback-tutorial.spec.ts / goals-tutorial.spec.ts: the same custom tooltip, the same
// "Step N of M" counter, Next/Done by exact accessible name.

const MANAGER_LANDMARKS = [
  "nobody approves them",
  "leave planner",
  "Whose calendar switches",
  "Flip months",
  "My days off lists",
  "what remains this year",
  "My team lists",
  "one row per report and pool",
  "on a report's behalf",
  "Recording your own days off starts here",
  "counts working days only",
  "Done takes you back to Days off",
];

async function walkTutorial(page: Page): Promise<string[]> {
  await page.getByRole("button", { name: "How days off work" }).click();
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

/** The caller's own days-off list total — the tour.spec bearer-token idiom. */
async function ownDaysOffTotal(page: Page, request: APIRequestContext): Promise<number> {
  const token = await page.evaluate(() => localStorage.getItem("lettuce.auth.token"));
  const res = await request.get(`/api/v1/days-off?view=own&pageSize=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return ((await res.json()) as { total: number }).total;
}

test("the days-off tutorial walks a manager through 12 read-only steps and returns to the Days off page", async ({
  page,
  request,
}) => {
  await login(page, MANAGER_AAA);
  await collapseAlertsBanner(page);
  await page.goto("/days-off");

  const ownBefore = await ownDaysOffTotal(page, request);

  const seen = await walkTutorial(page);

  expect(seen).toHaveLength(12);
  assertLandmarkOrder(seen, MANAGER_LANDMARKS);
  await expect(page).toHaveURL(/\/days-off\?tab=requests/);

  expect(await ownDaysOffTotal(page, request)).toBe(ownBefore);
});

test("the days-off tutorial shows a non-manager 8 steps without the manager steps", async ({ page, request }) => {
  await login(page, AAA_ONE);
  await collapseAlertsBanner(page);
  await page.goto("/days-off");

  const ownBefore = await ownDaysOffTotal(page, request);

  const seen = await walkTutorial(page);

  expect(seen).toHaveLength(8);
  for (const text of seen) {
    expect(text).not.toContain("Whose calendar switches");
    expect(text).not.toContain("My team lists");
    expect(text).not.toContain("on a report's behalf");
  }
  await expect(page).toHaveURL(/\/days-off\?tab=requests/);

  expect(await ownDaysOffTotal(page, request)).toBe(ownBefore);
});
