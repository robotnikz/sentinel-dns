import { expect, test } from '@playwright/test';

test('Filtering allow/block: add and remove a manual rule', async ({ page }) => {
  const domain = `ads-${Date.now()}.example.com`;

  await page.goto('/');

  await page.getByRole('button', { name: 'Filtering' }).click();
  await expect(page.locator('header').getByRole('heading', { name: 'Filter Rules' })).toBeVisible();

  await page.getByRole('button', { name: 'Allow/Block' }).click();
  await expect(page.getByText('Add Custom Rule')).toBeVisible();

  await page.getByPlaceholder('Enter domain (e.g. ads.example.com)').fill(domain);
  const addRule = page.waitForResponse((r) => r.url().includes('/api/rules') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'BLOCK', exact: true }).click();
  await addRule;

  // The UI state update is async; reloading ensures we validate persisted backend state too.
  await page.reload();
  await page.getByRole('button', { name: 'Filtering' }).click();
  await page.getByRole('button', { name: 'Allow/Block' }).click();

  await expect(page.getByText(domain)).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: `Delete rule ${domain}` }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Filtering' }).click();
  await page.getByRole('button', { name: 'Allow/Block' }).click();
  await expect(page.getByText(domain)).toHaveCount(0);
});
