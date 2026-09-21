import { ADMIN, AAA_ONE, MANAGER_AAA, collapseAlertsBanner, expect, login, recordApiWrites, test } from "./helpers";
import type { Page } from "@playwright/test";

// The "How pulse surveys work" tutorial (v3.21.0) walked as an admin, a manager, and a team
// member, asserting the landmark order the script promises and the read-only invariant — nothing
// is created, changed or deleted. Reuses the guided tour's counter-loop idiom (tests/tour.spec.ts),
// same as feedback-tutorial.spec.ts / goals-tutorial.spec.ts / days-off-tutorial.spec.ts /
// performance-reviews-tutorial.spec.ts / one-on-ones-tutorial.spec.ts / impact-log-tutorial.spec.ts /
// team-kpis-tutorial.spec.ts: the same custom tooltip, the same "Step N of M" counter, Next/Done by
// exact accessible name, and the recordApiWrites no-non-GET oracle (v3.16.2, shared via helpers.ts).
//
// This is the FIRST three-audience tutorial: every employee answers (member), managers/HR monitor
// participation, admins run the cycle registry. A fresh DB has no pulse cycle and at most one
// non-terminal cycle exists org-wide at a time — `pulse.spec.ts` owns that singleton and runs in
// its own serial phase, chained after `alerts.spec.ts` (see `e2e/playwright.config.ts`). This spec
// deliberately anchors only cycle-independent chrome (the four hub tabs + the admin registry page's
// Settings/New-cycle/registry blocks) and reads no cycle-dependent DOM and compares no totals — it
// owns nothing and needs no serial phase of its own; the filename doesn't match the config's
// `/(alerts|pulse)\.spec\.ts/` testIgnore/testMatch patterns (which require the literal suffix
// "alerts.spec.ts"/"pulse.spec.ts", not merely containing "pulse"), so it runs in the default
// parallel `chromium` project alongside the other `*-tutorial.spec.ts` files.
//
// The admin walk's step count depends on whether the ADMIN seed account also manages a team in the
// shared DB (the `managerOrHr`-gated Participation step) — derived from the same signal the app's
// own gate uses (`useIsManager`: total of teams with `managerId` = caller), never hard-coded.

const ADMIN_LANDMARKS = [
  "nothing is saved",
  "Current survey is where",
  "Seven steps",
  "Your answers are encrypted",
  "Results shows closed cycles",
  "Trend follows one measure",
  "Pulse cycles is the admin registry",
  "Settings hold the cadence",
  "New cycle schedules",
  "The registry lists every cycle",
  "Done takes you back to Pulse surveys",
];

const MANAGER_LANDMARKS = [
  "nothing is saved",
  "Current survey is where",
  "Seven steps",
  "Your answers are encrypted",
  "Results shows closed cycles",
  "Trend follows one measure",
  "Participation shows who",
  "Done takes you back to Pulse surveys",
];

const MEMBER_LANDMARKS = [
  "nothing is saved",
  "Current survey is where",
  "Seven steps",
  "Your answers are encrypted",
  "Results shows closed cycles",
  "Trend follows one measure",
  "Done takes you back to Pulse surveys",
];

async function walkTutorial(page: Page): Promise<string[]> {
  await page.getByRole("button", { name: "How pulse surveys work" }).click();
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

test("the pulse surveys tutorial walks an admin through the cycle-management steps and returns to the Pulse surveys page", async ({
  page,
  request,
}) => {
  await login(page, ADMIN);
  await collapseAlertsBanner(page);
  await page.goto("/pulse");

  // The shared dev DB may carry a manually created team managed by the admin, which would
  // legitimately add the managerOrHr-gated Participation step — derive the expectation from the
  // same signal the app's own gate uses (`useIsManager`: total of teams with managerId = caller).
  const token = await page.evaluate(() => localStorage.getItem("lettuce.auth.token"));
  const userId = await page.evaluate(() => localStorage.getItem("lettuce.auth.userId"));
  const managed = (await (
    await request.get(`/api/v1/teams?managerId=${userId}&pageSize=1`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json()) as { total: number };
  const managesTeam = managed.total > 0;
  const expected = 11 + (managesTeam ? 1 : 0);
  const landmarks = managesTeam
    ? [...ADMIN_LANDMARKS.slice(0, 6), "Participation shows who", ...ADMIN_LANDMARKS.slice(6)]
    : ADMIN_LANDMARKS;

  const writes = recordApiWrites(page);

  const seen = await walkTutorial(page);

  expect(seen).toHaveLength(expected);
  assertLandmarkOrder(seen, landmarks);
  expect(seen.some((text) => text.includes("Participation shows who"))).toBe(managesTeam);
  await expect(page).toHaveURL(/\/pulse\?tab=survey/);

  expect(writes).toEqual([]);
});

test("the pulse surveys tutorial walks a manager through 8 read-only steps and returns to the Pulse surveys page", async ({
  page,
}) => {
  await login(page, MANAGER_AAA);
  await collapseAlertsBanner(page);
  await page.goto("/pulse");

  const writes = recordApiWrites(page);

  const seen = await walkTutorial(page);

  expect(seen).toHaveLength(8);
  assertLandmarkOrder(seen, MANAGER_LANDMARKS);
  for (const text of seen) {
    expect(text).not.toContain("Pulse cycles is the admin registry");
    expect(text).not.toContain("Settings hold the cadence");
    expect(text).not.toContain("New cycle schedules");
    expect(text).not.toContain("The registry lists every cycle");
  }
  await expect(page).toHaveURL(/\/pulse\?tab=survey/);

  expect(writes).toEqual([]);
});

test("the pulse surveys tutorial shows a team member 7 steps without the participation and admin steps", async ({
  page,
}) => {
  await login(page, AAA_ONE);
  await collapseAlertsBanner(page);
  await page.goto("/pulse");

  const writes = recordApiWrites(page);

  const seen = await walkTutorial(page);

  expect(seen).toHaveLength(7);
  assertLandmarkOrder(seen, MEMBER_LANDMARKS);
  for (const text of seen) {
    expect(text).not.toContain("Participation shows who");
    expect(text).not.toContain("Pulse cycles is the admin registry");
    expect(text).not.toContain("New cycle schedules");
  }
  await expect(page).toHaveURL(/\/pulse\?tab=survey/);

  expect(writes).toEqual([]);
});
