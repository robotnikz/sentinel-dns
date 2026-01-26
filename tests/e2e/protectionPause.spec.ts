import { expect, test } from '@playwright/test';

test('pause protection dropdown can pause and resume', async ({ page }) => {
  await page.goto('/');

  const pauseButton = page.getByRole('button', { name: 'Pause protection' });
  await expect(pauseButton).toBeVisible();

  const openPauseMenu = async () => {
    const resume = page.getByRole('button', { name: 'Resume protection' });
    // The toggle button closes the menu if it's already open; click until we see a menu item.
    for (let i = 0; i < 2; i++) {
      await pauseButton.click();
      if (await resume.isVisible().catch(() => false)) return;
    }
    await expect(resume).toBeVisible();
  };

  // Pause
  await openPauseMenu();
  await page.getByRole('button', { name: 'Pause 15 minutes' }).click();

  await expect(pauseButton).toContainText('PAUSED', { timeout: 15_000 });
  await expect(page.locator('header').getByText('Protection Paused', { exact: true })).toBeVisible();

  // Resume
  await openPauseMenu();
  const resume = page.getByRole('button', { name: 'Resume protection' });
  await expect(resume).toBeEnabled({ timeout: 20_000 });
  await resume.click();

  await expect(page.locator('header').getByText('Protection Paused', { exact: true })).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('header').getByText('Active', { exact: true })).toBeVisible();
});
