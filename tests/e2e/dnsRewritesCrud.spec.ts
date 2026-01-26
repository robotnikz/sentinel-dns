import { expect, test } from '@playwright/test';

test('Local DNS rewrites: add and delete record', async ({ page }) => {
  const domain = `printer-${Date.now()}.lan`;
  const target = '192.168.1.10';

  await page.goto('/');

  await page.getByRole('button', { name: 'Local DNS' }).click();
  await expect(page.locator('header').getByRole('heading', { name: 'DNS Configuration' })).toBeVisible();

  await page.getByRole('button', { name: 'Local Records' }).click();
  await expect(page.getByText('DNS Rewrites')).toBeVisible();

  await page.getByRole('button', { name: 'ADD RECORD' }).click();
  await expect(page.getByText('Add DNS Rewrite')).toBeVisible();

  await page.getByPlaceholder('printer.lan').fill(domain);
  await page.getByPlaceholder('192.168.1.10 or host.local').fill(target);

  await page.getByRole('button', { name: 'SAVE' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  await expect(page.getByText(domain)).toBeVisible();
  await expect(page.getByText(target)).toBeVisible();

  await page.getByRole('button', { name: `Delete rewrite ${domain}` }).click();
  await expect(page.getByText('Deleted')).toBeVisible();

  await expect(page.getByText(domain)).toHaveCount(0);
});
