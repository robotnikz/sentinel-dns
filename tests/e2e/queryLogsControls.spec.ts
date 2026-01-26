import { expect, test } from '@playwright/test';

test('Query logs: tabs + basic controls are usable', async ({ page }) => {
  await page.goto('/#logs');

  // Queries tab (default)
  await expect(page.getByRole('button', { name: 'Queries' })).toBeVisible();
  await expect(page.getByPlaceholder('Filter log output...')).toBeVisible();

  await page.getByPlaceholder('Filter log output...').fill('example.com');
  await expect(page.getByPlaceholder('Filter log output...')).toHaveValue('example.com');

  // Pagination / page size controls should exist even with 0 rows.
  await expect(page.getByLabel('Rows per page')).toBeVisible();
  await page.getByLabel('Rows per page').selectOption('50');
  await expect(page.getByLabel('Rows per page')).toHaveValue('50');

  // Switch to Suspicious Activity tab
  await page.getByRole('button', { name: 'Suspicious Activity' }).click();
  await expect(page.getByPlaceholder('Search anomalies...')).toBeVisible();

  // Toggle show/hide ignored (text changes)
  const toggle = page.getByRole('button', { name: /Show ignored|Hide ignored/ });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByRole('button', { name: /Show ignored|Hide ignored/ })).toBeVisible();
});
