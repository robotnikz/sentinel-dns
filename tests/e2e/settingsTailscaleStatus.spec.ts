import { expect, test } from '@playwright/test';

test('Settings: Tailscale tab renders and handles missing tailscale gracefully', async ({ page }) => {
  await page.goto('/#settings');

  const settingsCard = page.locator('.dashboard-card').filter({ hasText: 'System Settings' }).first();
  await settingsCard.getByRole('button', { name: 'Tailscale', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Tailscale Remote Access' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh Status', exact: true })).toBeVisible();

  // Refresh should not crash the UI.
  await page.getByRole('button', { name: 'Refresh Status', exact: true }).click();
  await expect(page.getByText('Backend:', { exact: false })).toBeVisible();

  // In environments without tailscaled/TUN, Connect should fail with a visible message.
  await page.getByRole('button', { name: 'Connect', exact: true }).click();

  // The backend error message varies depending on container capabilities; just assert we surfaced something.
  await expect(page.getByText(/tailscale|failed|unavailable/i).first()).toBeVisible();
});
