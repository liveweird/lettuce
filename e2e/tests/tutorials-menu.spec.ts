import { AAA_ONE, MANAGER_AAA, collapseAlertsBanner, expect, login, recordApiWrites, test } from "./helpers";
import type { Page } from "@playwright/test";

// The account menu's Tutorials submenu (v4.4.0): the app tour plus every per-feature tutorial the
// caller can use, launched from ANY page — a menu launch opens the tutorial's hub first. Read-only
// by construction (a tutorial only navigates and spotlights), so the oracle is "no non-GET API
// request at all" (recordApiWrites) rather than a list total other workers could move.

const NON_MANAGER_TUTORIALS = [
  "How feedback works",
  "How 1:1 meetings work",
  "How goals work",
  "How the impact log works",
  "How days off work",
  "How team KPIs work",
  "How performance reviews work",
  "How pulse surveys work",
];

async function openTutorialsMenu(page: Page) {
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("menuitem", { name: "Tutorials" }).click();
  await expect(page.getByRole("menuitem", { name: "Quick app tour" })).toBeVisible();
}

const tutorialEntries = (page: Page) =>
  page.getByRole("menuitem").filter({ hasText: /^How / }).allTextContents();

test("a team member launches the goals tutorial from the Dashboard's account menu and it returns to Goals", async ({
  page,
}) => {
  await login(page, AAA_ONE);
  await collapseAlertsBanner(page);
  await page.goto("/");
  const writes = recordApiWrites(page);

  await openTutorialsMenu(page);
  // No succession entry: its nav leaf is manager-only, and the menu mirrors the nav.
  expect(await tutorialEntries(page)).toEqual(NON_MANAGER_TUTORIALS);

  await page.getByRole("menuitem", { name: "How goals work" }).click();
  await expect(page).toHaveURL(/\/goals\?tab=own$/);

  // Walk the whole tutorial: the non-manager audience of "How goals work" is six steps.
  for (let step = 1; step <= 6; step++) {
    const counter = page.getByText(`Step ${step} of 6`, { exact: true });
    await expect(counter).toBeVisible();
    const tooltip = page.locator("div").filter({ has: counter }).last();
    await tooltip.getByRole("button", { name: step === 6 ? "Done" : "Next", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/goals\?tab=own$/);
  await expect(page.getByText(/^Step \d+ of \d+$/)).toHaveCount(0);
  expect(writes, "API writes during the tutorial").toEqual([]);
});

test("a manager's Tutorials list includes succession plans, and a launch from Kudos opens that hub", async ({
  page,
}) => {
  await login(page, MANAGER_AAA);
  await collapseAlertsBanner(page);
  await page.goto("/kudos");
  const writes = recordApiWrites(page);

  await openTutorialsMenu(page);
  expect(await tutorialEntries(page)).toEqual([...NON_MANAGER_TUTORIALS, "How succession plans work"]);

  await page.getByRole("menuitem", { name: "How succession plans work" }).click();
  await expect(page).toHaveURL(/\/succession\?tab=own$/);
  const counter = page.getByText(/^Step 1 of \d+$/);
  await expect(counter).toBeVisible();
  await page.locator("div").filter({ has: counter }).last().getByRole("button", { name: "Abandon" }).click();
  await expect(page.getByText(/^Step \d+ of \d+$/)).toHaveCount(0);
  expect(writes, "API writes during the tutorial").toEqual([]);
});
