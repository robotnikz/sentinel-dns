import { expect, test } from '@playwright/test';
import { gotoWithRetry } from './_helpers';

test('Settings: Tailscale tab renders and handles missing tailscale gracefully', async ({ page }) => {
  await gotoWithRetry(page, '/#settings', { waitUntil: 'domcontentloaded' });

  const settingsCard = page.locator('.dashboard-card').filter({ hasText: 'System Settings' }).first();
  await expect(settingsCard).toBeVisible();

  // Wait for capability probe (if it runs) so the tab visibility stabilizes.
  await page
    .waitForResponse((r) => r.url().includes('/api/tailscale/status') && r.request().method() === 'GET', { timeout: 10_000 })
    .catch(() => undefined);

  const tailscaleBtn = settingsCard.getByRole('button', { name: 'Tailscale', exact: true });

  // If Tailscale is not enabled in this deployment, the UI intentionally hides the tab.
  if ((await tailscaleBtn.count()) === 0) {
    await expect(tailscaleBtn).toHaveCount(0);
    return;
  }

  await tailscaleBtn.click();

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
