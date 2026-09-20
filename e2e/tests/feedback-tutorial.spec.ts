import { AAA_ONE, MANAGER_AAA, collapseAlertsBanner, expect, login, test } from "./helpers";
import type { Page } from "@playwright/test";

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

/**
 * Every non-GET `/api/` request the page issues from now on — the read-only oracle. List totals
 * are NOT a safe before/after comparison for this walker: parallel specs write as the same seed
 * account (hr.spec drafts a feedback as Manager AAA), so a total can move mid-walk through no
 * fault of the tutorial. The walker's own traffic is exactly what "nothing is saved" promises.
 * `/api/v1/refresh` is a token exchange, not a write, and is allowed.
 */
function recordApiWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith("/api/") && r.method() !== "GET" && path !== "/api/v1/refresh") {
      writes.push(`${r.method()} ${path}`);
    }
  });
  return writes;
}

test("the feedback tutorial walks a manager through 12 read-only steps and returns to the Feedback page", async ({ page }) => {
  await login(page, MANAGER_AAA);
  await collapseAlertsBanner(page);
  await page.goto("/feedback");

  const writes = recordApiWrites(page);

  const seen = await walkTutorial(page);

  expect(seen).toHaveLength(12);
  assertLandmarkOrder(seen, MANAGER_LANDMARKS);
  await expect(page).toHaveURL(/\/feedback\?tab=received/);

  expect(writes).toEqual([]);
});

test("the feedback tutorial shows a non-manager 9 steps without the team steps", async ({ page }) => {
  await login(page, AAA_ONE);
  const writes = recordApiWrites(page);
  await collapseAlertsBanner(page);
  await page.goto("/feedback");

  const seen = await walkTutorial(page);

  expect(seen).toHaveLength(9);
  for (const text of seen) {
    expect(text).not.toContain("My team shows");
    expect(text).not.toContain("Request feedback");
  }
  await expect(page).toHaveURL(/\/feedback\?tab=received/);
  expect(writes).toEqual([]);
});
