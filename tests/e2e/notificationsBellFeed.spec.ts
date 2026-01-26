import { expect, test } from '@playwright/test';

test('Notifications bell: protection pause event appears in feed', async ({ page }) => {
  await page.goto('/');

  // Trigger an event that creates a bell notification (server-side persist), without requiring WAN.
  const pauseButton = page.getByRole('button', { name: 'Pause protection' });
  await expect(pauseButton).toBeVisible();

  await pauseButton.click();
  await page.getByRole('button', { name: 'Pause 15 minutes' }).click();

  await expect(pauseButton).toContainText('PAUSED', { timeout: 15_000 });
  await expect(page.locator('header').getByText('Protection Paused', { exact: true })).toBeVisible();

  // Open the bell feed (header widget).
  await page.locator('header').getByRole('button', { name: 'Notifications' }).click();

  await expect(page.getByText('Recent events', { exact: true })).toBeVisible();
  // This label can appear multiple times (e.g. list + toast), so avoid strict-mode ambiguity.
  await expect(page.getByText('Protection paused', { exact: true }).first()).toBeVisible();

  // The UI marks notifications as read when opening the bell.
  await expect(page.getByText(/All read|\d+ unread|Loading…/).first()).toBeVisible();
});
