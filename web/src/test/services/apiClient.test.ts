import { describe, expect, it, vi } from 'vitest';
import { apiFetch, getAdminToken, getAuthHeaders, setAdminToken } from '../../services/apiClient';

describe('apiClient', () => {
  it('returns empty token and headers for cookie-based auth', () => {
    expect(getAdminToken()).toBe('');
    expect(getAuthHeaders()).toEqual({});
  });

  it('setAdminToken is a no-op', () => {
    expect(() => setAdminToken('any')).not.toThrow();
  });

  it('apiFetch defaults credentials to include', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as any);

    await apiFetch('/api/health');

    expect(fetch).toHaveBeenCalledTimes(1);
    const args = (fetch as any).mock.calls[0];
    expect(args[0]).toBe('/api/health');
    expect(args[1]?.credentials).toBe('include');
  });
});
