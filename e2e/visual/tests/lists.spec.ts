import type { Page } from '@playwright/test';
import { capture } from '../capture';
import { dictionary, expect, provided, received, test } from '../fixtures';


async function feedbackReady(page: Page, tab: 'received' | 'provided', language: 'en' | 'pl' = 'en') {
  await page.goto(`/feedback?tab=${tab}`);
  await expect(page.getByRole('heading', { name: 'Feedback', exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(2);
  const labels = language === 'en' ? { received: 'Received', provided: 'Provided' }
    : { received: 'Otrzymane', provided: 'Wystawione' };
  await expect(page.getByRole('tab', { name: labels[tab], exact: true })).toHaveAttribute('aria-selected', 'true');
  const rows = page.locator('#main-content tbody tr');
  const data = tab === 'received' ? received : provided;
  await expect(rows).toHaveCount(data.length);
  const statuses = language === 'en'
    ? { SENT: 'Sent', DRAFT: 'Draft', REQUESTED: 'Requested', WITHDRAWN: 'Withdrawn', REJECTED: 'Rejected' }
    : { SENT: 'Wysłano', DRAFT: 'Wersja robocza', REQUESTED: 'Poproszono', WITHDRAWN: 'Wycofano', REJECTED: 'Odrzucono' };
  for (const [index, item] of data.entries()) {
    const row = rows.nth(index);
    await expect(row.getByText(statuses[item.status], { exact: true })).toBeVisible();
    if (tab === 'received') await expect(row.getByText(item.providerName, { exact: true })).toBeVisible();
    else for (const person of item.subjects) await expect(row.getByText(person.name, { exact: true })).toBeVisible();
    if (item.requesterName) await expect(row.getByText(item.requesterName, { exact: true })).toBeVisible();
    const action = row.locator('td:last-child').getByRole('link');
    await expect(action).toHaveCount(1);
    const editable = tab === 'provided' && ['DRAFT', 'REQUESTED'].includes(item.status);
    const label = language === 'en' ? (editable ? /^Edit/ : /^View/) : (editable ? /^Edytuj/ : /^Wyświetl/);
    await expect(action).toHaveAccessibleName(label);
    await expect(action).toHaveAttribute('href', new RegExp(`^/feedback/${item.id}/${editable ? 'edit' : 'view'}(?:\\?|$)`));
    await expect(action).toBeVisible();
    const bounds = await action.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeInViewport();
  }
}

test('member received feedback retains its desktop layout', async ({ page }) => {
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await feedbackReady(page, 'received');
    await capture(page, `feedback-received-en-light-${width}.png`);
  }
});

test('member provided feedback retains its desktop actions and statuses', async ({ page }) => {
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await feedbackReady(page, 'provided');
    await capture(page, `feedback-provided-en-light-${width}.png`);
  }
});

test('all four dictionaries retain compact read-only desktop rows', async ({ page }) => {
  for (const [slug, title] of [
    ['career-paths', 'Career paths'], ['career-specializations', 'Career specializations'],
    ['seniority-levels', 'Seniority levels'], ['pulse-rotating-questions', 'Pulse rotating questions'],
  ]) {
    await page.goto(`/dictionaries/${slug}`);
    const main = page.locator('#main-content');
    await expect(main.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(main.locator('tbody tr')).toHaveCount(dictionary.items.length);
    for (const entry of dictionary.items) await expect(main.getByText(entry.values.en, { exact: true })).toBeVisible();
    await expect(main.getByRole('textbox')).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Add entry', exact: true })).toHaveCount(0);
    await capture(page, `dictionary-${slug}-member-en-light-1280.png`);
  }
});

test.describe('dictionary administrator', () => {
  test.use({ visualRole: 'admin' });
  test('administrator dictionary keeps its editable desktop rows', async ({ page }) => {
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/dictionaries/career-paths');
      const main = page.locator('#main-content');
      await expect(main.getByRole('textbox', { name: 'Entry 1 (English)', exact: true })).toHaveValue('Engineering');
      await expect(main.getByRole('textbox')).toHaveCount(dictionary.items.length * 2);
      for (const [index, entry] of dictionary.items.entries()) {
        await expect(main.getByRole('textbox', { name: `Entry ${index + 1} (English)`, exact: true })).toHaveValue(entry.values.en);
      }
      await expect(main.getByRole('button', { name: 'Add entry', exact: true })).toBeVisible();
      await expect(main.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
      await capture(page, `dictionary-career-paths-admin-en-light-${width}.png`);
    }
  });
});

test.describe('Polish desktop', () => {
  test.use({ visualLanguage: 'pl', locale: 'pl-PL' });
  test('Polish provided feedback keeps translated desktop labels contained', async ({ page }) => {
    await feedbackReady(page, 'provided', 'pl');
    await capture(page, 'feedback-provided-pl-light-1280.png');
  });
});

test.describe('dark desktop', () => {
  test.use({ colorScheme: 'dark' });
  test('read-only dictionary retains its dark desktop appearance', async ({ page }) => {
    await page.goto('/dictionaries/career-paths');
    await expect(page.locator('#main-content tbody tr')).toHaveCount(dictionary.items.length);
    await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
    await capture(page, 'dictionary-career-paths-member-en-dark-1280.png');
  });
});
