import {
  AAA_ONE,
  MANAGER_AAA,
  collapseAlertsBanner,
  expect,
  login,
  recordApiWrites,
  test,
} from "./helpers";
import type { Page } from "@playwright/test";

// The "How 1:1 meetings work" tutorial (v3.18.0) walked as a manager and as a non-manager,
// asserting the landmark order the script promises and the read-only invariant — nothing is
// created, changed or deleted. Reuses the guided tour's counter-loop idiom (tests/tour.spec.ts),
// same as feedback-tutorial.spec.ts / goals-tutorial.spec.ts / days-off-tutorial.spec.ts /
// performance-reviews-tutorial.spec.ts: the same custom tooltip, the same "Step N of M" counter,
// Next/Done by exact accessible name, and the recordApiWrites no-non-GET oracle (v3.16.2, shared
// via helpers.ts). Nothing here is data-dependent — no precondition like the review-period one.

const MANAGER_LANDMARKS = [
  "nothing is saved",
  "I'm a subordinate lists",
  "Under Filters you narrow",
  "three lists",
  "carried over into it automatically",
  "I'm a manager lists",
  "My subordinate's a manager shows",
  "A new 1:1 starts here",
  "Pick the team member",
  "Create saves the meeting",
  "In the editor you add",
  "Each card on My subordinates",
  "Done takes you back to 1:1 meetings",
];

async function walkTutorial(page: Page): Promise<string[]> {
  await page.getByRole("button", { name: "How 1:1 meetings work" }).click();
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

test("the 1:1 meetings tutorial walks a manager through 13 read-only steps and returns to the 1:1 meetings page", async ({
  page,
}) => {
  await login(page, MANAGER_AAA);
  await collapseAlertsBanner(page);
  await page.goto("/one-on-ones");

  const writes = recordApiWrites(page);

  const seen = await walkTutorial(page);

  expect(seen).toHaveLength(13);
  assertLandmarkOrder(seen, MANAGER_LANDMARKS);
  await expect(page).toHaveURL(/\/one-on-ones\?tab=own/);

  expect(writes).toEqual([]);
});

test("the 1:1 meetings tutorial shows a non-manager 6 steps without the team steps", async ({ page }) => {
  await login(page, AAA_ONE);
  await collapseAlertsBanner(page);
  await page.goto("/one-on-ones");

  const writes = recordApiWrites(page);

  const seen = await walkTutorial(page);

  expect(seen).toHaveLength(6);
  for (const text of seen) {
    expect(text).not.toContain("I'm a manager lists");
    expect(text).not.toContain("A new 1:1 starts here");
    expect(text).not.toContain("In the editor you add");
  }
  await expect(page).toHaveURL(/\/one-on-ones\?tab=own/);
  expect(writes).toEqual([]);
});
