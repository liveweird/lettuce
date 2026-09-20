import { AAA_ONE, MANAGER_AAA, collapseAlertsBanner, expect, login, test } from "./helpers";
import type { APIRequestContext, Page } from "@playwright/test";

// The "How feedback works" tutorial (v3.14.0) walked as a manager and as a non-manager, asserting
// the landmark order the script promises and the read-only invariant — nothing is created,
// changed or deleted, so the provided/received totals must be unchanged before vs. after the walk.
// Reuses the guided tour's counter-loop idiom (tests/tour.spec.ts): the same custom tooltip,
// the same "Step N of M" counter, Next/Done by exact accessible name.

const MANAGER_LANDMARKS = [
  "nothing is saved",
  "Requested",
  "Received lists",
  "Provided is everything",
  "My team shows",
  "Reports",
  "Writing feedback starts here",
  "Pick up to four",
  "Save draft keeps",
  "Ask for feedback",
  "Request feedback",
  "Kudos wall",
];

async function walkTutorial(page: Page): Promise<string[]> {
  await page.getByRole("button", { name: "How feedback works" }).click();
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

/** The caller's own feedback list total for `view` — the tour.spec bearer-token idiom. */
async function feedbackTotal(
  page: Page,
  request: APIRequestContext,
  view: "provided" | "received",
): Promise<number> {
  const token = await page.evaluate(() => localStorage.getItem("lettuce.auth.token"));
  const res = await request.get(`/api/v1/feedbacks?view=${view}&pageSize=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return ((await res.json()) as { total: number }).total;
}

test("the feedback tutorial walks a manager through 12 read-only steps and returns to the Feedback page", async ({
  page,
  request,
}) => {
  await login(page, MANAGER_AAA);
  await collapseAlertsBanner(page);
  await page.goto("/feedback");

  const providedBefore = await feedbackTotal(page, request, "provided");
  const receivedBefore = await feedbackTotal(page, request, "received");

  const seen = await walkTutorial(page);

  expect(seen).toHaveLength(12);
  assertLandmarkOrder(seen, MANAGER_LANDMARKS);
  await expect(page).toHaveURL(/\/feedback\?tab=received/);

  expect(await feedbackTotal(page, request, "provided")).toBe(providedBefore);
  expect(await feedbackTotal(page, request, "received")).toBe(receivedBefore);
});

test("the feedback tutorial shows a non-manager 9 steps without the team steps", async ({ page }) => {
  await login(page, AAA_ONE);
  await collapseAlertsBanner(page);
  await page.goto("/feedback");

  const seen = await walkTutorial(page);

  expect(seen).toHaveLength(9);
  for (const text of seen) {
    expect(text).not.toContain("My team shows");
    expect(text).not.toContain("Request feedback");
  }
  await expect(page).toHaveURL(/\/feedback\?tab=received/);
});
