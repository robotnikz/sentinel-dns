import { expect, test } from '@playwright/test';

test('Settings: notifications webhook + event toggles can be saved', async ({ page }) => {
  await page.goto('/#settings');

  const settingsCard = page.locator('.dashboard-card').filter({ hasText: 'System Settings' }).first();
  await settingsCard.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();

  // Do NOT use a real Discord webhook URL in tests (avoid outbound network).
  // Saving this value has no server-side validation; the TEST endpoint will reject it.
  await page.getByPlaceholder('https://discord.com/api/webhooks/...').fill('https://example.invalid/not-a-discord-webhook');

  await page.getByRole('button', { name: 'SAVE', exact: true }).click();
  await expect(page.getByText('Saved.', { exact: true }).first()).toBeVisible();

  // TEST should fail fast without contacting the network.
  await page.getByRole('button', { name: 'TEST', exact: true }).click();
  await expect(page.getByText('No valid Discord webhook configured on the server.', { exact: true }).first()).toBeVisible();

  // Toggle one event and save.
  const geoipToggle = page.getByLabel('GeoIP database updated');
  const wasChecked = await geoipToggle.isChecked();
  await geoipToggle.setChecked(!wasChecked);
  await page.getByRole('button', { name: 'SAVE EVENTS' }).click();
  await expect(page.getByText('Saved.', { exact: true }).first()).toBeVisible();

  // Verify persistence after reload.
  await page.reload();
  await settingsCard.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await expect(geoipToggle).toBeChecked({ checked: !wasChecked });

  // Cleanup: restore original toggle state and clear webhook value.
  await geoipToggle.setChecked(wasChecked);
  await page.getByRole('button', { name: 'SAVE EVENTS' }).click();
  await expect(page.getByText('Saved.', { exact: true }).first()).toBeVisible();

  await page.getByPlaceholder('https://discord.com/api/webhooks/...').fill('');
  await page.getByRole('button', { name: 'SAVE', exact: true }).click();
  await expect(page.getByText('Saved.', { exact: true }).first()).toBeVisible();
});
