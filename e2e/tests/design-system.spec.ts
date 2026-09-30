import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { apiToken, authHeader } from "./api";
import { AAA_ONE, ADMIN, HR, MANAGER_AAA, createUserViaUi, expect, login, logout, switchLanguage, test } from "./helpers";

let ownedUser: { id: number; token: string } | undefined;
test.afterEach(async ({ request }) => {
  if (!ownedUser) return;
  const removed = await request.delete(`/api/v1/users/${ownedUser.id}`, { headers: authHeader(ownedUser.token) });
  ownedUser = undefined;
  expect(removed.ok()).toBe(true);
});

async function contained(page: Page) {
  await expect.poll(() => page.evaluate(() =>
    Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) <= document.documentElement.clientWidth,
  )).toBe(true);
}

test("dashboard details and labelled actions remain reachable at every supported width", async ({ page }) => {
  await login(page, MANAGER_AAA);
  for (const width of [1440, 1280, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/?tab=subordinates");
    const card = page.locator("main li").filter({ has: page.getByText("AAA One", { exact: true }) });
    await expect(card).toBeVisible();
    const disclosure = card.locator("details");
    await expect(disclosure).not.toHaveAttribute("open");
    await card.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(disclosure).toHaveAttribute("open");
    await expect(card.getByText("Last login", { exact: true })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(disclosure).not.toHaveAttribute("open");
    const actions = card.getByRole("button", { name: "Feedbacks: Feedback actions for AAA One", exact: true });
    await expect(actions).toBeVisible();
    await actions.click();
    await expect(page.getByRole("menuitem", { name: "Provide feedback to AAA One", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await contained(page);
  }
});

test("employees and HR keep readable reference tables without administrative controls", async ({ page }) => {
  for (const email of [AAA_ONE, HR]) {
    await login(page, email);
    await expect(page.getByRole("group", { name: "Administration", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Directory", exact: true }).click();
    await expect(page.getByRole("link", { name: "Users", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Resources", exact: true }).click();
    await expect(page.getByRole("link", { name: "Review periods", exact: true })).toBeVisible();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const slug of ["career-paths", "career-specializations", "seniority-levels"]) {
        await page.goto(`/dictionaries/${slug}`);
        const table = page.getByRole("table");
        await expect(table).toBeVisible();
        await expect(table).toHaveCSS("display", "table");
        await expect(table.getByRole("columnheader")).toHaveCount(3);
        await expect(table.getByRole("row").nth(1).getByRole("cell")).toHaveCount(3);
        await contained(page);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await logout(page);
  }
});

test("Polish dark-mode forms and references remain accessible on a phone", async ({ page, request }) => {
  test.setTimeout(120_000);
  const token = await apiToken(request, ADMIN);
  await login(page, ADMIN);
  const person = await createUserViaUi(page, "E2E Design");
  ownedUser = { id: person.id, token };
  await logout(page);
  await login(page, person.email, person.password);
  await switchLanguage(page, "Polski");
  await page.getByRole("button", { name: /Toggle color scheme|Przełącz motyw/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", "dark");
  await page.setViewportSize({ width: 390, height: 1000 });
  for (const path of ["/dictionaries/career-paths", "/feedback/new", "/days-off/new"]) {
    await page.goto(path);
    await expect(page.locator("main h2")).toBeVisible();
    await contained(page);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }))).toEqual([]);
  }

});
