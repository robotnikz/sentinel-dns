import { describe, expect, it } from 'vitest';
import { getAdminToken, getAuthHeaders, setAdminToken } from '../../services/apiClient';

describe('apiClient', () => {
  it('returns empty token and headers for cookie-based auth', () => {
    expect(getAdminToken()).toBe('');
    expect(getAuthHeaders()).toEqual({});
  });

  it('setAdminToken is a no-op', () => {
    expect(() => setAdminToken('any')).not.toThrow();
  });
});
