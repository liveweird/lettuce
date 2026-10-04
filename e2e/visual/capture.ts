import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export async function capture(page: Page, name: string) {
  await expect(page.locator('[data-tour="user-menu"]')).toContainText('Aleksandra Kowalska-Nowak');
  const loadedFonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return (await document.fonts.load('400 14px "Inter Variable"')).length;
  });
  expect(loadedFonts, 'The bundled Inter font must exist and load; fallback fonts are not a baseline').toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= window.innerWidth,
  )).toBe(true);
  // Desktop tables can intentionally stack within a narrow content container. Include
  // every row vertically, but independently reject horizontal overflow before capture.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page).toHaveScreenshot(name, { fullPage: true });
}

