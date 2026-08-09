import { collapseAlertsBanner, expect, login, MANAGER_AAA, test } from "./helpers";

// The guided tour, actually walked: replay it as a manager and assert the landmark order the
// tour promises — every left-menu section (Changelog included) and every tab of the views they
// open, before the header icons. Anchors/steps that vanish or reorder fail this walk.
// The suite's tour-seen stub only suppresses the AUTO-start; the replay button always works.
//
// 47, not the full 50: MANAGER_AAA is a manager but NOT an ADMIN, so the three admin-only
// Config leaves (Pulse cycles, Feature flags, Alerts) are correctly absent from their walk.

const LANDMARKS = [
  "Take a quick tour",
  "Feedback",
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
  "Changelog — what's new",
  "Notifications",
  "Switch the interface language",
  "Toggle light and dark",
  "Your account menu",
  "Replay this tour",
];

test("the guided tour walks all 47 manager steps in the documented order", async ({ page }) => {
  await login(page, MANAGER_AAA);
  // A pre-existing active alert's expanded banner overlays the header (and the replay button).
  await collapseAlertsBanner(page);
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

  expect(seen).toHaveLength(47);
  // Each landmark appears, strictly after the previous one.
  let cursor = -1;
  for (const landmark of LANDMARKS) {
    const at = seen.findIndex((text, i) => i > cursor && text.includes(landmark));
    expect(at, `landmark "${landmark}" after step ${cursor + 1}`).toBeGreaterThan(cursor);
    cursor = at;
  }
  // The tour's closing step returned home.
  await expect(page).toHaveURL(/\/$|\?tab=/);
});
