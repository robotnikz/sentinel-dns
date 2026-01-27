import { expect, test } from '@playwright/test';

test('API rejects invalid settings key (schema validation)', async ({ page }) => {
  // Ensure auth storageState is loaded and UI is reachable.
  await page.goto('/');

  const res = await page.request.put('/api/settings/bad$key', {
    data: { value: 'x' }
  });

  expect(res.status()).toBe(400);
});
