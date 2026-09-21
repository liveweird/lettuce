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

// The "How succession plans work" tutorial (v3.22.0, the ninth and last feature-area tutorial)
// walked as a manager and as a non-manager, asserting the landmark order the script promises and
// the read-only invariant — nothing is created, changed or deleted. Reuses the guided tour's
// counter-loop idiom (tests/tour.spec.ts), same as feedback-tutorial.spec.ts /
// goals-tutorial.spec.ts / days-off-tutorial.spec.ts / performance-reviews-tutorial.spec.ts /
// one-on-ones-tutorial.spec.ts / impact-log-tutorial.spec.ts / team-kpis-tutorial.spec.ts /
// pulse-tutorial.spec.ts: the same custom tooltip, the same "Step N of M" counter, Next/Done by
// exact accessible name, and the recordApiWrites no-non-GET oracle (v3.16.2, shared via
// helpers.ts). The parallel succession.spec.ts writes as Manager AAA — plans for seat AAA One,
// candidates AAA Two/Three — the request oracle here ignores that traffic (it only records THIS
// page's own non-GET requests), and no list total is ever compared. The Succession plans nav leaf
// is manager-only, so the non-manager walk navigates to /succession directly by URL.

const MANAGER_LANDMARKS = [
  "nothing is saved",
  "My plans lists",
  "Under Filters you narrow",
  "My subordinates' plans shows",
  "A new plan starts here",
  "Pick a person from your reporting line",
  "Loss impact is a short ordered list",
  "Create saves the plan",
  "Nominations are the successors",
  "Opening a plan is the Review screen",
  "Only the owner writes a plan",
  "Each card on My subordinates",
  "Done takes you back to Succession plans",
];

async function walkTutorial(page: Page): Promise<string[]> {
  await page.getByRole("button", { name: "How succession plans work" }).click();
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

test("the succession plans tutorial walks a manager through 13 read-only steps and returns to the Succession plans page", async ({
  page,
}) => {
  await login(page, MANAGER_AAA);
  await collapseAlertsBanner(page);
  await page.goto("/succession");

  const writes = recordApiWrites(page);

  const seen = await walkTutorial(page);

  expect(seen).toHaveLength(13);
  assertLandmarkOrder(seen, MANAGER_LANDMARKS);
  await expect(page).toHaveURL(/\/succession\?tab=own/);

  expect(writes).toEqual([]);
});

test("the succession plans tutorial shows a non-manager 5 steps without the planning steps", async ({
  page,
}) => {
  await login(page, AAA_ONE);
  await collapseAlertsBanner(page);
  await page.goto("/succession");

  const writes = recordApiWrites(page);

  const seen = await walkTutorial(page);

  expect(seen).toHaveLength(5);
  for (const text of seen) {
    expect(text).not.toContain("My subordinates' plans shows");
    expect(text).not.toContain("A new plan starts here");
    expect(text).not.toContain("Nominations are the successors");
    expect(text).not.toContain("Each card on My subordinates");
  }
  await expect(page).toHaveURL(/\/succession\?tab=own/);
  expect(writes).toEqual([]);
});
