import { expect, test } from '@playwright/test';

test('DNS discovery: can toggle and save settings', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Local DNS' }).click();
  await expect(page.locator('header').getByRole('heading', { name: 'DNS Configuration' })).toBeVisible();

    await page.getByRole('button', { name: 'Client Discovery' }).click();
    await expect(page.getByRole('heading', { name: 'Client Discovery', exact: true })).toBeVisible();

  // Toggle reverse DNS on/off (the switch uses title On/Off).
  const switchLocator = page.locator('div[title="On"], div[title="Off"]').first();
  await expect(switchLocator).toBeVisible();
  await switchLocator.click();

  await page.getByPlaceholder('e.g. 192.168.1.1').fill('192.168.1.1');
  await page.getByPlaceholder('250').fill('250');

  await page.getByRole('button', { name: 'SAVE' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
});
