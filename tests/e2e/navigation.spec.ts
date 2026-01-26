import { expect, test } from '@playwright/test';

async function expectHeaderTitle(page: any, title: string) {
  await expect(page.locator('header').getByRole('heading', { name: title })).toBeVisible();
}

test('sidebar navigation clickthrough renders all pages', async ({ page }) => {
  await page.goto('/');
  await expectHeaderTitle(page, 'Network Overview');

  await page.getByRole('button', { name: 'Query Log' }).click();
  await expectHeaderTitle(page, 'Query Inspector');

  await page.getByRole('button', { name: 'Network Map' }).click();
  await expectHeaderTitle(page, 'Network Topology');

  await page.getByRole('button', { name: 'Filtering' }).click();
  await expectHeaderTitle(page, 'Filter Rules');

  await page.getByRole('button', { name: 'Client Policies' }).click();
  await expectHeaderTitle(page, 'Client Inventory');

  await page.getByRole('button', { name: 'Local DNS' }).click();
  await expectHeaderTitle(page, 'DNS Configuration');

  await page.getByRole('button', { name: 'System Settings' }).click();
  await expectHeaderTitle(page, 'System Settings');

  // Collapse and ensure we can still navigate back.
  await page.getByRole('button', { name: 'Collapse Sidebar' }).click();
  await page.getByRole('button', { name: 'Overview' }).click();
  await expectHeaderTitle(page, 'Network Overview');
});
