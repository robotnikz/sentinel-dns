import { expect, test } from '@playwright/test';

test('Clients: can add a device and find it via search', async ({ page }) => {
  const name = `E2E Device ${Date.now()}`;
  const ip = '192.168.1.99';

  await page.goto('/#clients');

  await page.getByRole('button', { name: 'ADD DEVICE' }).click();
  await expect(page.getByText('Add New Device', { exact: true })).toBeVisible();

  await page.getByPlaceholder('e.g. Living Room Xbox').fill(name);
  await page.getByPlaceholder('192.168.1.50').fill(ip);

  await page.getByRole('button', { name: 'SAVE', exact: true }).click();

  // After modal closes, search for the new device.
  await page.getByPlaceholder('Search MAC / IP / Name').fill(name);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
});
