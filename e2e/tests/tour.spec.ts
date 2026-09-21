import { ADMIN, collapseAlertsBanner, expect, login, MANAGER_AAA, test } from "./helpers";
import type { Page } from "@playwright/test";

// The guided tour, actually walked twice: as a manager and as the admin, asserting the landmark
// order the tour promises — since v3.23.0 the tour is a menu presentation only: one stop per
// left-nav leaf/group (navbar order), then the four header icons and the help/replay icon. No
// step navigates anywhere — feature depth lives in the per-feature "How … works" tutorials
// instead. The suite's tour-seen stub only suppresses the AUTO-start; the replay button always
// works.
//
// Audience math over the 22 steps: MANAGER_AAA is a manager, so the manager-only Succession step
// is present → 22. The seed admin is an ADMIN but manages no team, so the Succession step is
// absent → 21, +1 when the shared dev DB gives the admin a team (the existing `managerId` probe).

const LANDMARKS = [
  "Take a quick tour",
  "Dashboard —",
  "Kudos —",
  "Feedback —",
  "1:1 meetings —",
  "Goals —",
  "Impact log —",
  "Career —",
  "Days off —",
  "Team KPIs —",
  "Performance —",
  "Pulse —",
  "Succession plans —",
  "Config —",
  "Dictionaries —",
  "Change password —",
  "Changelog —",
  "Notifications —",
  "Switch the interface language",
  "Toggle light and dark",
  "Your account menu",
  "That's it!",
];

// The admin walk's landmark subset: the manager-only Succession step drops out, everything else
// stays in the same order (the TOUR_STEPS navbar order).
const ADMIN_LANDMARKS = LANDMARKS.filter((landmark) => landmark !== "Succession plans —");

async function walkTour(page: Page): Promise<string[]> {
  await page.locator('[data-tour="replay"]').click();
  const seen: string[] = [];
  for (let step = 1; step <= 30; step++) {
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

test("the guided tour walks all 22 manager menu steps in the documented order", async ({
  page,
}) => {
  await login(page, MANAGER_AAA);
  // A pre-existing active alert's expanded banner overlays the header (and the replay button).
  await collapseAlertsBanner(page);
  const before = page.url();
  const seen = await walkTour(page);

  expect(seen).toHaveLength(22);
  assertLandmarkOrder(seen, LANDMARKS);
  // No step navigates — the walk never left the Dashboard.
  await expect(page).toHaveURL(before);
});

test("the guided tour walks the 21 admin menu steps without the manager-only Succession stop", async ({
  page,
  request,
}) => {
  await login(page, ADMIN);
  await collapseAlertsBanner(page);
  const before = page.url();

  // The shared dev DB may carry a manually created team managed by the admin, which would
  // legitimately add the Succession step — derive the expectation from the same signal the
  // app's own gate uses (`useIsManager`: total of teams with managerId = caller).
  const token = await page.evaluate(() => localStorage.getItem("lettuce.auth.token"));
  const userId = await page.evaluate(() => localStorage.getItem("lettuce.auth.userId"));
  const managed = (await (
    await request.get(`/api/v1/teams?managerId=${userId}&pageSize=1`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json()) as { total: number };
  const expected = 21 + (managed.total > 0 ? 1 : 0);

  const seen = await walkTour(page);

  expect(seen).toHaveLength(expected);
  assertLandmarkOrder(seen, ADMIN_LANDMARKS);
  // No step navigates — the walk never left the Dashboard.
  await expect(page).toHaveURL(before);
});
