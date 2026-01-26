import { expect, test } from '@playwright/test';

test('DNS upstream: selection updates UI and save works', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Local DNS' }).click();
  await expect(page.locator('header').getByRole('heading', { name: 'DNS Configuration' })).toBeVisible();

  // Upstream tab is the default, but be explicit.
  await page.getByRole('button', { name: 'Upstream Resolvers' }).click();

  // Changing selection should update the Effective Status summary.
  await page.getByText('Google (DoH)', { exact: true }).first().click();
  await expect(page.getByText('Based on the currently selected upstream resolver:')).toBeVisible();
  await expect(page.getByText('Google (DoH)', { exact: true }).first()).toBeVisible();

  // Switch back to the default local resolver so we don't alter behavior.
  await page.getByText('Unbound (Local)', { exact: true }).first().click();
  await expect(page.getByText('Unbound (Local)', { exact: true }).first()).toBeVisible();

  // Save should succeed.
  await page.getByRole('button', { name: 'SAVE CHANGES' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
});
