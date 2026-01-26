import { expect, test } from '@playwright/test';

test('Settings: can save AI keys (encrypted server-side)', async ({ page }) => {
  const geminiKey = `AIza-e2e-${Date.now()}-dummy`;

  await page.goto('/');

  await page.getByRole('button', { name: 'System Settings' }).click();
  await expect(page.locator('header').getByRole('heading', { name: 'System Settings' })).toBeVisible();

  await page.getByRole('button', { name: 'AI Keys' }).click();
  await expect(page.getByRole('heading', { name: 'AI Keys' })).toBeVisible();

  await page.getByPlaceholder('AIza…').fill(geminiKey);
  await page.getByRole('button', { name: 'SAVE' }).click();

  await expect(page.getByText('Saved')).toBeVisible();
});
