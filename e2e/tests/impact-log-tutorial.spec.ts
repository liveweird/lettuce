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

// The "How the impact log works" tutorial (v3.19.0) walked as a manager and as a non-manager,
// asserting the landmark order the script promises and the read-only invariant — nothing is
// created, changed or deleted. Reuses the guided tour's counter-loop idiom (tests/tour.spec.ts),
// same as feedback-tutorial.spec.ts / goals-tutorial.spec.ts / days-off-tutorial.spec.ts /
// performance-reviews-tutorial.spec.ts / one-on-ones-tutorial.spec.ts: the same custom tooltip,
// the same "Step N of M" counter, Next/Done by exact accessible name, and the recordApiWrites
// no-non-GET oracle (v3.16.2, shared via helpers.ts). The parallel impact-log.spec.ts writes as
// AAA Two and reads as Manager AAA — the request oracle here ignores that traffic (it only
// records THIS page's own non-GET requests), and no list total is ever compared.

const MANAGER_LANDMARKS = [
  "nothing is saved",
  "My journal lists",
  "Under Filters you narrow",
  "A new entry starts here",
  "The title and the period stay visible",
  "one section at a time",
  "Each section is markdown",
  "Back and Next move",
  "My subordinates' journals lists",
  "Here Filters add the author",
  "Each card on My subordinates",
  "Done takes you back to the Impact log",
];

async function walkTutorial(page: Page): Promise<string[]> {
  await page.getByRole("button", { name: "How the impact log works" }).click();
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

test("the impact log tutorial walks a manager through 12 read-only steps and returns to the Impact log page", async ({
  page,
}) => {
  await login(page, MANAGER_AAA);
  await collapseAlertsBanner(page);
  await page.goto("/impact-log");

  const writes = recordApiWrites(page);

  const seen = await walkTutorial(page);

  expect(seen).toHaveLength(12);
  assertLandmarkOrder(seen, MANAGER_LANDMARKS);
  await expect(page).toHaveURL(/\/impact-log\?tab=own/);

  expect(writes).toEqual([]);
});

test("the impact log tutorial shows a non-manager 9 steps without the subordinates steps", async ({
  page,
}) => {
  await login(page, AAA_ONE);
  await collapseAlertsBanner(page);
  await page.goto("/impact-log");

  const writes = recordApiWrites(page);

  const seen = await walkTutorial(page);

  expect(seen).toHaveLength(9);
  for (const text of seen) {
    expect(text).not.toContain("My subordinates' journals lists");
    expect(text).not.toContain("Here Filters add the author");
    expect(text).not.toContain("Each card on My subordinates");
  }
  await expect(page).toHaveURL(/\/impact-log\?tab=own/);
  expect(writes).toEqual([]);
});
