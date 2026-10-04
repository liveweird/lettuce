import type { Page } from '@playwright/test';
import { capture } from '../capture';
import { expect, test } from '../fixtures';
import { cardPeople, people, teams } from '../people-fixtures';

test.use({ visualScenario: 'people' });

async function dashboardReady(page: Page, managed: boolean) {
  await page.goto(`/?tab=${managed ? 'subordinates' : 'managers'}`);
  const main = page.locator('#main-content');
  await expect(main.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(main.getByRole('tab', { name: managed ? 'My subordinates' : 'My managers', exact: true })).toHaveAttribute('aria-selected', 'true');
  for (const label of ['Feedback requests for you', 'Your active goals', 'Feedback received · 30 days', 'Pulse survey open until']) {
    await expect(main.getByRole('link').filter({ hasText: label })).toBeVisible();
  }
  await expect(main.getByRole('link').filter({ hasText: 'Direct reports' })).toHaveCount(managed ? 1 : 0);
  const cards = main.locator('li');
  const items = cardPeople(managed);
  await expect(cards).toHaveCount(items.length);
  for (const [index, person] of items.entries()) {
    await expect(cards.nth(index).getByText(person.name, { exact: true })).toBeVisible();
    await expect(cards.nth(index).getByText(person.email, { exact: true })).toBeVisible();
    await expect(cards.nth(index).getByRole('link').first()).toBeVisible();
  }
}

async function usersReady(page: Page, admin: boolean) {
  await page.goto('/users');
  const main = page.locator('#main-content');
  await expect(main.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
  await expect(main.locator('tbody tr')).toHaveCount(people.length);
  for (const person of people) {
    const row = main.locator('tbody tr').filter({ hasText: person.email });
    await expect(row.getByText(person.name, { exact: true })).toBeVisible();
    const teamsLink = row.getByRole('link', { name: `Teams for ${person.name}`, exact: true });
    await expect(teamsLink).toBeVisible();
    await teamsLink.scrollIntoViewIfNeeded();
    await expect(teamsLink).toBeInViewport();
    await expect(row.getByRole('button', { name: `Modify actions for ${person.name}`, exact: true })).toHaveCount(admin ? 1 : 0);
  }
  await expect(main.getByText('Inactive', { exact: true })).toHaveCount(1);
  await expect(main.getByText('Not set', { exact: true })).toHaveCount(1);
  await expect(main.getByRole('link', { name: 'New user', exact: true })).toHaveCount(admin ? 1 : 0);
  await expect(main.getByRole('link', { name: 'Mass import', exact: true })).toHaveCount(admin ? 1 : 0);
}

async function teamsReady(page: Page, admin: boolean) {
  await page.goto('/teams');
  const main = page.locator('#main-content');
  await expect(main.getByRole('heading', { name: 'Teams', exact: true })).toBeVisible();
  await expect(main.locator('tbody tr')).toHaveCount(teams.length);
  for (const team of teams) {
    const row = main.locator('tbody tr').filter({ hasText: team.name });
    await expect(row.getByRole('link', { name: `Team details for ${team.name}`, exact: true })).toBeVisible();
    await expect(row.getByText(team.managerName, { exact: true })).toBeVisible();
    await expect(row.getByRole('link', { name: `Edit ${team.name}`, exact: true })).toHaveCount(admin ? 1 : 0);
    if (!admin) await expect(row.getByRole('button')).toHaveCount(0);
  }
  await expect(main.getByRole('link', { name: 'New team', exact: true })).toHaveCount(admin ? 1 : 0);
}

test('member dashboard retains its summary tiles and manager cards', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await dashboardReady(page, false);
  await capture(page, 'dashboard-member-en-light-1440.png');
});

test('member users list retains readable identity and accessible actions', async ({ page }) => {
  await usersReady(page, false);
  await capture(page, 'users-member-en-light-1280.png');
});

test('member teams list retains read-only team and manager links', async ({ page }) => {
  await teamsReady(page, false);
  await capture(page, 'teams-member-en-light-1280.png');
});

test.describe('manager dashboard', () => {
  test.use({ visualRole: 'manager' });
  test('manager dashboard retains direct-report tiles and populated subordinate cards', async ({ page }) => {
    await dashboardReady(page, true);
    await capture(page, 'dashboard-manager-en-light-1280.png');
  });
});

test.describe('administrator directory', () => {
  test.use({ visualRole: 'admin', viewport: { width: 1440, height: 1000 } });
  test('administrator users list retains account controls and mixed account states', async ({ page }) => {
    await usersReady(page, true);
    await capture(page, 'users-admin-en-light-1440.png');
  });
  test('administrator teams list retains editing actions with long names', async ({ page }) => {
    await teamsReady(page, true);
    await capture(page, 'teams-admin-en-light-1440.png');
  });
});
