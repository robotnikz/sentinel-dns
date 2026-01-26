import { expect, test } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERNAME } from './_credentials';
import { gotoWithRetry } from './_helpers';

test.describe('auth gate', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('requires login and then lands on dashboard', async ({ page }) => {
    await gotoWithRetry(page, '/');

    await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible();

    await page.getByPlaceholder('Enter username').fill(E2E_USERNAME);
    await page.getByPlaceholder('Enter admin password').fill(E2E_PASSWORD);

    await page.getByRole('button', { name: 'Login' }).click();

    await expect(page.locator('header').getByRole('heading', { name: 'Network Overview' })).toBeVisible();
  });
});
