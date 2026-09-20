import { AAA_ONE, MANAGER_AAA, collapseAlertsBanner, expect, login, test } from "./helpers";
import type { APIRequestContext, Page } from "@playwright/test";

// The "How goals work" tutorial (v3.15.0) walked as a manager and as a non-manager, asserting
// the landmark order the script promises and the read-only invariant — nothing is created,
// changed or deleted, so the walker's OWN goal total must be unchanged before vs. after the walk.
// Only `view=own` is compared: goals.spec.ts runs in a parallel worker and creates goals as
// Manager AAA for AAA Two, which ride Manager AAA's `view=managed` list — a race, not a signal.
// Nobody creates goals FOR Manager AAA, so their own total is stable.
// Reuses the guided tour's counter-loop idiom (tests/tour.spec.ts), same as feedback-tutorial.spec.ts:
// the same custom tooltip, the same "Step N of M" counter, Next/Done by exact accessible name.

const MANAGER_LANDMARKS = [
  "nothing is saved",
  "starts as a Draft",
  "My goals lists",
  "by title, status",
  "record progress",
  "widens it from your direct reports",
  "Creating a goal starts here",
  "Pick the team member",
  "Create saves the draft",
  "run its lifecycle",
  "My subordinates",
  "Done takes you back to Goals",
];

async function walkTutorial(page: Page): Promise<string[]> {
  await page.getByRole("button", { name: "How goals work" }).click();
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

/** The caller's own goal list total — the tour.spec bearer-token idiom. */
async function goalTotal(
  page: Page,
  request: APIRequestContext,
  view: "own",
): Promise<number> {
  const token = await page.evaluate(() => localStorage.getItem("lettuce.auth.token"));
  const res = await request.get(`/api/v1/goals?view=${view}&pageSize=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return ((await res.json()) as { total: number }).total;
}

test("the goals tutorial walks a manager through 12 read-only steps and returns to the Goals page", async ({
  page,
  request,
}) => {
  await login(page, MANAGER_AAA);
  await collapseAlertsBanner(page);
  await page.goto("/goals");

  const ownBefore = await goalTotal(page, request, "own");

  const seen = await walkTutorial(page);

  expect(seen).toHaveLength(12);
  assertLandmarkOrder(seen, MANAGER_LANDMARKS);
  await expect(page).toHaveURL(/\/goals\?tab=own/);

  expect(await goalTotal(page, request, "own")).toBe(ownBefore);
});

test("the goals tutorial shows a non-manager 6 steps without the manager steps", async ({ page }) => {
  await login(page, AAA_ONE);
  await collapseAlertsBanner(page);
  await page.goto("/goals");

  const seen = await walkTutorial(page);

  expect(seen).toHaveLength(6);
  for (const text of seen) {
    expect(text).not.toContain("widens it from your direct reports");
    expect(text).not.toContain("Creating a goal starts here");
    expect(text).not.toContain("My subordinates");
  }
  await expect(page).toHaveURL(/\/goals\?tab=own/);
});
