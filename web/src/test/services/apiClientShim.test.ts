import { describe, expect, it, vi, afterEach } from 'vitest';
import { installApiFetchDefaults } from '../../services/apiClient';

describe('installApiFetchDefaults', () => {
  const originalFetch = window.fetch;

  afterEach(() => {
    window.fetch = originalFetch;
    (window as any).__sentinelApiFetchShimInstalled = false;
    vi.restoreAllMocks();
  });

  it('adds credentials: include to relative /api/* fetch calls', async () => {
    const spy = vi.fn(async () => new Response(null, { status: 200 }));
    window.fetch = spy as any;

    installApiFetchDefaults();

    await window.fetch('/api/health');

    expect(spy).toHaveBeenCalledTimes(1);
    const call = (spy.mock.calls[0] ?? []) as unknown[];
    const init = (call[1] ?? {}) as RequestInit;
    expect(init.credentials).toBe('include');
  });

  it('does not force credentials for non-/api paths', async () => {
    const spy = vi.fn(async () => new Response(null, { status: 200 }));
    window.fetch = spy as any;

    installApiFetchDefaults();

    await window.fetch('/assets/logo.svg', { credentials: 'omit' } as any);

    expect(spy).toHaveBeenCalledTimes(1);
    const call = (spy.mock.calls[0] ?? []) as unknown[];
    const init = (call[1] ?? {}) as RequestInit;
    expect(init.credentials).toBe('omit');
  });
});
