import type { Page } from '@playwright/test';

export async function gotoWithRetry(
  page: Page,
  url: string,
  opts: { retries?: number; delayMs?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' } = {}
): Promise<void> {
  const retries = opts.retries ?? 5;
  const delayMs = opts.delayMs ?? 500;
  const waitUntil = opts.waitUntil ?? 'load';

  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      await page.goto(url, { waitUntil });
      return;
    } catch (e) {
      lastErr = e;
      // Transient compose/port-forward hiccups can produce ERR_CONNECTION_FAILED.
      await page.waitForTimeout(delayMs);
    }
  }

  throw lastErr;
}
