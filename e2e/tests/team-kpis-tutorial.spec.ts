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

// The "How team KPIs work" tutorial (v3.20.0) walked as a manager and as a team member, asserting
// the landmark order the script promises and the read-only invariant — nothing is created, changed
// or deleted. Reuses the guided tour's counter-loop idiom (tests/tour.spec.ts), same as
// feedback-tutorial.spec.ts / goals-tutorial.spec.ts / days-off-tutorial.spec.ts /
// performance-reviews-tutorial.spec.ts / one-on-ones-tutorial.spec.ts / impact-log-tutorial.spec.ts:
// the same custom tooltip, the same "Step N of M" counter, Next/Done by exact accessible name, and
// the recordApiWrites no-non-GET oracle (v3.16.2, shared via helpers.ts). The parallel
// team-kpis.spec.ts writes as Manager AAA (creating/editing KPIs on team AAA) and as AAA One
// (recording values) — the request oracle here ignores that traffic (it only records THIS page's
// own non-GET requests), and no list total is ever compared. The whirlwind tour (tour.spec.ts)
// shares the same `team-kpis-own`/`team-kpis-managed` anchors via tourSupport.ts, but that is a
// separate walkthrough and irrelevant to this spec.

const MANAGER_LANDMARKS = [
  "nothing is saved",
  "starts as a Draft",
  "My teams' KPIs lists",
  "Under Filters you narrow",
  "KPI data tab",
  "The Graph tab plots",
  "Managed KPIs lists",
  "Here Filters add the Reports scope",
  "A new team KPI starts here",
  "Pick the team",
  "Create saves the KPI",
  "drives the lifecycle",
  "Each team on My teams",
  "Done takes you back to Team KPIs",
];

async function walkTutorial(page: Page): Promise<string[]> {
  await page.getByRole("button", { name: "How team KPIs work" }).click();
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

test("the team KPIs tutorial walks a manager through 14 read-only steps and returns to the Team KPIs page", async ({
  page,
}) => {
  await login(page, MANAGER_AAA);
  await collapseAlertsBanner(page);
  await page.goto("/team-kpis");

  const writes = recordApiWrites(page);

  const seen = await walkTutorial(page);

  expect(seen).toHaveLength(14);
  assertLandmarkOrder(seen, MANAGER_LANDMARKS);
  await expect(page).toHaveURL(/\/team-kpis\?tab=own/);

  expect(writes).toEqual([]);
});

test("the team KPIs tutorial shows a team member 7 steps without the manager steps", async ({
  page,
}) => {
  await login(page, AAA_ONE);
  await collapseAlertsBanner(page);
  await page.goto("/team-kpis");

  const writes = recordApiWrites(page);

  const seen = await walkTutorial(page);

  expect(seen).toHaveLength(7);
  for (const text of seen) {
    expect(text).not.toContain("Managed KPIs lists");
    expect(text).not.toContain("A new team KPI starts here");
    expect(text).not.toContain("drives the lifecycle");
  }
  await expect(page).toHaveURL(/\/team-kpis\?tab=own/);
  expect(writes).toEqual([]);
});
