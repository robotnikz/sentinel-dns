import { expect, test } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import { E2E_PASSWORD, E2E_USERNAME } from './_credentials';

test('authenticate and persist storage state', async ({ page }) => {
  const storageStatePath = path.resolve(process.cwd(), 'tests/e2e/.auth/admin.json');
  await fs.mkdir(path.dirname(storageStatePath), { recursive: true });

  await page.goto('/');

  const firstRunHeading = page.getByRole('heading', { name: 'First-run setup' });
  const loginHeading = page.getByRole('heading', { name: 'Login' });

  if (await firstRunHeading.isVisible().catch(() => false)) {
    await page.getByPlaceholder('Enter username').fill(E2E_USERNAME);
    await page.getByPlaceholder('At least 8 characters').fill(E2E_PASSWORD);
    await page.getByPlaceholder('Confirm password').fill(E2E_PASSWORD);
    await page.getByRole('button', { name: 'Create user' }).click();
  } else {
    await expect(loginHeading).toBeVisible();
    await page.getByPlaceholder('Enter username').fill(E2E_USERNAME);
    await page.getByPlaceholder('Enter admin password').fill(E2E_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
  }

  await expect(page.locator('header').getByRole('heading', { name: 'Network Overview' })).toBeVisible();
  await page.context().storageState({ path: storageStatePath });
});
