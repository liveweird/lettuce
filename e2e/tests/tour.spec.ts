import { expect, login, MANAGER_AAA, test } from "./helpers";

// The guided tour, actually walked: replay it as a manager (the widest audience — 27 steps)
// and assert the landmark order the tour promises — every left-menu section (Changelog
// included) before the header icons. Anchors/steps that vanish or reorder fail this walk.
// The suite's tour-seen stub only suppresses the AUTO-start; the replay button always works.

const LANDMARKS = [
  "Take a quick tour",
  "Feedback",
  "1:1 meetings",
  "My goals — all the goals",
  "Config — users, teams",
  "Self-reflection",
  "Your account",
  "Changelog — what's new",
  "Notifications",
  "Switch the interface language",
  "Toggle light and dark",
  "Sign out",
  "Replay this tour",
];

test("the guided tour walks all 27 manager steps in the documented order", async ({ page }) => {
  await login(page, MANAGER_AAA);
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

  expect(seen).toHaveLength(27);
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
