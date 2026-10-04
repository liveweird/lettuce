import { expect, test } from '../fixtures';

test.use({ viewport: { width: 1280, height: 720 }, reducedMotion: 'no-preference' });

test('deep dictionary entry reveals the active link without scrolling the page or moving focus', async ({ page }) => {
  await page.goto('/dictionaries/pulse-rotating-questions');
  await expect(page.locator('#main-content').getByRole('heading', { name: 'Pulse rotating questions', exact: true })).toBeVisible();
  const active = page.locator('nav a[aria-current="page"]');
  await expect(active).toHaveAttribute('href', '/dictionaries/pulse-rotating-questions');
  // Assertion only: scrollIntoView/click here would hide the production defect.
  await expect(active).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(active).not.toBeFocused();
});

test('expanding the dictionary group and returning from the rail reveal the active item', async ({ page }) => {
  await page.goto('/dictionaries/seniority-levels');
  await expect(page.locator('#main-content').getByRole('heading', { name: 'Seniority levels', exact: true })).toBeVisible();
  const active = page.locator('nav a[aria-current="page"]');
  await expect(active).toBeInViewport({ ratio: 1 });
  const group = page.locator('[data-tour="nav-dictionaries"]');
  await group.click();
  // Mantine keeps collapsed children mounted while clipping them to the collapse's zero height.
  // Playwright's visibility check only considers the link's own box, so assert the group state
  // and the user-observable geometry instead.
  await expect(group).not.toHaveAttribute('data-expanded');
  await expect(active).not.toBeInViewport();
  await group.click();
  await expect(active).toBeInViewport({ ratio: 1 });
  await expect(group).toBeFocused();
  const toggle = page.getByRole('button', { name: 'Show or hide the navigation', exact: true });
  await toggle.click();
  await expect(page.locator('nav a[aria-current="page"]')).toHaveCount(0);
  await toggle.click();
  await expect(active).toBeInViewport({ ratio: 1 });
  await expect(toggle).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});


test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('reopening an active dictionary group reveals its item without animation', async ({ page }) => {
    await page.goto('/dictionaries/pulse-rotating-questions');
    const active = page.locator('nav a[aria-current="page"]');
    await expect(active).toBeInViewport({ ratio: 1 });
    const group = page.locator('[data-tour="nav-dictionaries"]');
    await group.click();
    await expect(group).not.toHaveAttribute('data-expanded');
    await expect(active).not.toBeInViewport();
    await group.click();
    await expect(active).toBeInViewport({ ratio: 1 });
    await expect(group).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});
