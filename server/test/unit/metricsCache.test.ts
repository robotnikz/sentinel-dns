import Fastify from 'fastify';
import rateLimit from 'fastify-rate-limit';
import { describe, expect, it, vi } from 'vitest';

describe('unit: metrics cache', () => {
  it('caches responses for identical requests within TTL', async () => {
    vi.resetModules();

    vi.doMock('../../src/auth.js', () => ({
      requireAdmin: async () => undefined
    }));

    const { registerMetricsRoutes } = await import('../../src/routes/metrics.js');

    const app = Fastify({ logger: false });
    await app.register(rateLimit, { global: false });

    const db = {
      pool: {
        query: vi.fn().mockResolvedValueOnce({ rows: [{ total: 10n, blocked: 2n, clients: 3n }] })
      }
    } as any;

    const config = {
      METRICS_CACHE_TTL_MS: 10_000
    } as any;

    await registerMetricsRoutes(app, config, db);
    await app.ready();

    const r1 = await app.inject({ method: 'GET', url: '/api/metrics/summary?hours=24' });
    expect(r1.statusCode).toBe(200);

    expect(db.pool.query).toHaveBeenCalledTimes(1);

    const r2 = await app.inject({ method: 'GET', url: '/api/metrics/summary?hours=24' });
    expect(r2.statusCode).toBe(200);

    // second request should be served from cache (no extra DB calls)
    expect(db.pool.query).toHaveBeenCalledTimes(1);

    await app.close();
  });
});
