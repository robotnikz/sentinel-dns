import { describe, expect, it, vi } from 'vitest';
import { analyzeDomain } from '../../services/geminiService';

describe('geminiService.analyzeDomain', () => {
  it('returns backend error message when response is not ok', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: 'nope' })
    } as any);

    await expect(analyzeDomain('example.com')).resolves.toBe('nope');
  });

  it('returns a helpful message when AI is not configured', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: 'AI_NOT_CONFIGURED', message: 'not configured' })
    } as any);

    await expect(analyzeDomain('example.com')).resolves.toBe('not configured');
  });

  it('returns analysis text on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'analysis' })
    } as any);

    await expect(analyzeDomain('example.com')).resolves.toBe('analysis');
  });
});
