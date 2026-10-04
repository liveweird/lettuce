import type { Locator } from '@playwright/test';
import { capture } from '../capture';
import { expect, test } from '../fixtures';
import {
  DRAFT_FEEDBACK_ID,
  FORM_TEAM_ID,
  RELATIONSHIP_USER_ID,
  SENT_FEEDBACK_ID,
  draftFeedback,
  formTeam,
  sentFeedback,
} from '../forms-fixtures';

test.use({ visualScenario: 'forms' });

async function expectReady(main: Locator) {
  // Inactive React Activity tab panels can keep their loading UI mounted but hidden.
  // Only a visible loader or skeleton means the captured view is not ready.
  await expect(main.locator('.mantine-Loader-root:visible')).toHaveCount(0);
  await expect(main.locator('.mantine-Skeleton-root:visible')).toHaveCount(0);
}

test('feedback create keeps its initial recipient picker editor and disabled save actions', async ({ page }) => {
  await page.goto('/feedback/new');
  const main = page.locator('#main-content');
  await expect(main.getByRole('heading', { name: 'New feedback', exact: true })).toBeVisible();
  await expect(main.getByRole('combobox', { name: /Recipients/ })).toBeEnabled();
  await expect(main.getByRole('combobox', { name: 'Visibility', exact: true })).toHaveValue('Provider + subject');
  await expect(main.getByRole('combobox', { name: 'Template', exact: true })).toBeEnabled();
  await expect(main.locator('[contenteditable="true"]')).toBeVisible();
  await expect(main.getByRole('button', { name: 'Insert', exact: true })).toBeDisabled();
  await expect(main.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
  await expect(main.getByRole('button', { name: 'Save & send', exact: true })).toBeDisabled();
  await expectReady(main);
  await capture(page, 'feedback-create-initial-member-en-light-1280.png');
});

test('feedback draft edit keeps rich markdown multiple recipients and footer actions', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/feedback/${DRAFT_FEEDBACK_ID}/edit`);
  const main = page.locator('#main-content');
  await expect(main.getByRole('heading', { name: 'Edit feedback', exact: true })).toBeVisible();
  await expect(main.getByText('Draft', { exact: true })).toBeVisible();
  for (const recipient of draftFeedback.subjects) {
    await expect(main.getByText(recipient.name, { exact: true })).toBeVisible();
  }
  const editor = main.locator('[contenteditable="true"]');
  await expect(editor).toContainText('Platform launch');
  await expect(editor).toContainText('Clear ownership across teams');
  await expect(main.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled();
  await expect(main.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  await expect(main.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled();
  await expect(main.getByRole('button', { name: 'Save & send', exact: true })).toBeEnabled();
  await expectReady(main);
  await capture(page, 'feedback-draft-edit-multi-recipient-en-light-1440.png');
});

test('sent feedback detail keeps content metadata status and provider actions', async ({ page }) => {
  await page.goto(`/feedback/${SENT_FEEDBACK_ID}/view?as=provider`);
  const main = page.locator('#main-content');
  await expect(main.getByRole('heading', { name: 'Feedback', exact: true })).toBeVisible();
  await expect(main.getByText('Sent', { exact: true })).toBeVisible();
  await expect(main.getByLabel('Visibility: Provider + requester + subject')).toBeVisible();
  await expect(main.getByText('You', { exact: true })).toBeVisible();
  for (const recipient of sentFeedback.subjects) {
    await expect(main.getByText(recipient.name, { exact: true })).toBeVisible();
  }
  await expect(main.getByText(sentFeedback.requesterName!, { exact: true })).toBeVisible();
  await expect(main.getByText('A strong launch', { exact: true })).toBeVisible();
  await expect(main.getByRole('link', { name: 'Close', exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Share', exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Withdraw', exact: true })).toBeVisible();
  await expectReady(main);
  await capture(page, 'feedback-sent-detail-provider-en-light-1280.png');
});

test.describe('administrator form validation', () => {
  test.use({ visualRole: 'admin' });

  test('empty team create shows client validation without issuing a mutation', async ({ page }) => {
    await page.goto('/teams/new');
    const main = page.locator('#main-content');
    await expect(main.getByRole('heading', { name: 'New team', exact: true })).toBeVisible();
    await expect(main.getByRole('textbox', { name: 'Name', exact: true })).toBeFocused();
    await expect(main.getByRole('combobox', { name: 'Manager', exact: true })).toBeEnabled();
    await main.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(main.getByText('Name must be 1–100 characters', { exact: true })).toBeVisible();
    await expect(main.getByText('Manager is required', { exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Create', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/teams\/new$/);
    await expectReady(main);
    await capture(page, 'team-create-invalid-empty-admin-en-light-1280.png');
  });
});

test('team member detail keeps identity metadata and a read-only roster', async ({ page }) => {
  await page.goto(`/teams/${FORM_TEAM_ID}/details`);
  const main = page.locator('#main-content');
  await expect(main.getByRole('heading', { name: 'Team details', exact: true })).toBeVisible();
  await expect(main.getByText(formTeam.name, { exact: true })).toBeVisible();
  await expect(main.getByText(formTeam.managerName!, { exact: true })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Members', exact: true })).toBeVisible();
  const rows = main.locator('tbody tr');
  await expect(rows).toHaveCount(formTeam.memberIds.length);
  await expect(main.getByText('Maximilian Alexander von Hohenberg', { exact: true })).toBeVisible();
  await expect(main.getByText('Konstantyna Brzęczyszczykiewicz', { exact: true })).toBeVisible();
  await expect(main.getByRole('combobox', { name: 'Add a user', exact: true })).toHaveCount(0);
  await expect(main.getByText('2 total', { exact: true })).toBeVisible();
  await expectReady(main);
  await capture(page, 'team-detail-member-roster-en-light-1280.png');
});

test.describe('manager relationship detail', () => {
  test.use({ visualRole: 'manager', viewport: { width: 1440, height: 1000 } });

  test('user detail keeps the subordinate PersonCard stats badges and actions', async ({ page }) => {
    await page.goto(`/users/${RELATIONSHIP_USER_ID}/details?from=users`);
    const main = page.locator('#main-content');
    await expect(main.getByRole('heading', { name: 'Maximilian Alexander von Hohenberg', exact: true })).toBeVisible();
    await expect(main.getByText('One of your subordinates', { exact: true })).toBeVisible();
    const personCard = main.getByRole('listitem');
    await expect(personCard.getByText('International Experience', { exact: true })).toBeVisible();
    for (const section of ['Profile', 'Performance', 'Collaboration', 'Days off']) {
      await expect(personCard.getByText(section, { exact: true })).toBeVisible();
    }
    await expect(personCard.getByText('3', { exact: true })).toBeVisible();
    await expect(personCard.getByText('8.5', { exact: true })).toBeVisible();
    await expect(main.getByText('Actions', { exact: true })).toBeVisible();
    await expect(main.getByRole('link', { name: /Career progression of Maximilian/ })).toBeVisible();
    await expect(main.getByRole('button', { name: /Feedback actions for Maximilian/ })).toBeVisible();
    await expectReady(main);
    await capture(page, 'user-detail-subordinate-person-card-en-light-1440.png');
  });
});
