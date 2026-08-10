import { ADMIN, collapseAlertsBanner, expect, login, MANAGER_AAA, test } from "./helpers";
import type { Page } from "@playwright/test";

// The guided tour, actually walked twice: as a manager and as the admin, asserting the landmark
// order the tour promises — every left-menu section (Changelog included) and every tab of the
// views they open, before the header icons. Anchors/steps that vanish or reorder fail the walks.
// The suite's tour-seen stub only suppresses the AUTO-start; the replay button always works.
//
// Audience math over the 52 steps: MANAGER_AAA is a manager but NOT an ADMIN, so the three
// admin-only Config leaves (Pulse cycles, Feature flags, Alerts) are absent → 49. The seed
// admin is an ADMIN but manages no team, so the seven manager-only tab steps and the
// manager-or-HR Pulse participation step are absent → 44.

const LANDMARKS = [
  "Take a quick tour",
  "Feedback",
  "Kudos — the public wall of appreciation",
  "1:1 meetings",
  "Goals — the goals you're involved in",
  "My goals — the goals your managers set",
  "Goals I've set — the goals you've set",
  "Team KPIs — the measurable indicators",
  "My teams' KPIs — the active and archived KPIs",
  "KPIs I've set — the KPIs of the teams you manage",
  "Performance — the performance reviews your manager published",
  "My performance — every review published about you",
  "Team's performance — every subordinate's review",
  "Days off — the team calendar",
  "Calendar — who is away and when",
  "My requests — your own days off",
  "My team — the requests your direct reports have filed",
  "recurring pulse survey",
  "Current survey — the open cycle's questions",
  "Results — the anonymous eNPS",
  "Participation — how many people in the teams you watch",
  "Config — users, teams",
  "Review periods — the timeline of periods",
  "Public holidays — the non-working days",
  "Dictionaries — the shared lists",
  "Self-reflection",
  "Your account",
  "Email notifications",
  "Changelog — what's new",
  "Notifications",
  "Switch the interface language",
  "Toggle light and dark",
  "Your account menu",
  "Replay this tour",
];

// The admin walk's landmark subset: the manager-only tab steps drop out, the three admin-only
// Config leaves join between the registries and Dictionaries (the TOUR_STEPS order).
const ADMIN_LANDMARKS = [
  "Take a quick tour",
  "Feedback",
  "1:1 meetings",
  "Goals — the goals you're involved in",
  "Days off — the team calendar",
  "recurring pulse survey",
  "Config — users, teams",
  "Review periods — the timeline of periods",
  "Public holidays — the non-working days",
  "Pulse cycles — schedule a pulse survey",
  "Feature flags — turn individual features on or off",
  "Alerts — the announcement banners",
  "Dictionaries — the shared lists",
  "Your account",
  "Email notifications",
  "Replay this tour",
];

async function walkTour(page: Page): Promise<string[]> {
  await page.locator('[data-tour="replay"]').click();
  const seen: string[] = [];
  for (let step = 1; step <= 60; step++) {
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

test("the guided tour walks all 49 manager steps in the documented order", async ({ page }) => {
  await login(page, MANAGER_AAA);
  // A pre-existing active alert's expanded banner overlays the header (and the replay button).
  await collapseAlertsBanner(page);
  const seen = await walkTour(page);

  expect(seen).toHaveLength(49);
  assertLandmarkOrder(seen, LANDMARKS);
  // The tour's closing step returned home.
  await expect(page).toHaveURL(/\/$|\?tab=/);
});

test("the guided tour walks the 44 admin steps including the admin-only Config leaves", async ({
  page,
  request,
}) => {
  await login(page, ADMIN);
  await collapseAlertsBanner(page);

  // The shared dev DB may carry a manually created team managed by the admin, which would
  // legitimately add the 8 manager-gated steps — derive the expectation from the same signal
  // the app's own gate uses (`useIsManager`: total of teams with managerId = caller).
  const token = await page.evaluate(() => localStorage.getItem("lettuce.auth.token"));
  const userId = await page.evaluate(() => localStorage.getItem("lettuce.auth.userId"));
  const managed = (await (
    await request.get(`/api/v1/teams?managerId=${userId}&pageSize=1`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json()) as { total: number };
  const expected = 44 + (managed.total > 0 ? 8 : 0);

  const seen = await walkTour(page);

  expect(seen).toHaveLength(expected);
  assertLandmarkOrder(seen, ADMIN_LANDMARKS);
  await expect(page).toHaveURL(/\/$|\?tab=/);
});
