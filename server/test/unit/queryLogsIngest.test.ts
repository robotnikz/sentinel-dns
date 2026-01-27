import Fastify from 'fastify';
import rateLimit from 'fastify-rate-limit';
import { describe, expect, it, vi } from 'vitest';

describe('unit: query logs ingest batching', () => {
  it('inserts items in a single SQL statement', async () => {
    vi.resetModules();

    vi.doMock('../../src/auth.js', () => ({
      requireAdmin: async () => undefined
    }));

    const { registerQueryLogsRoutes } = await import('../../src/routes/queryLogs.js');

    const app = Fastify({ logger: false });
    await app.register(rateLimit, { global: false });

    const db = {
      pool: {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
      }
    } as any;

    const config = {} as any;

    await registerQueryLogsRoutes(app, config, db);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/query-logs/ingest',
      payload: {
        items: [
          { id: 'q1', domain: 'a.test', status: 'PERMITTED' },
          { id: 'q2', domain: 'b.test', status: 'BLOCKED' }
        ]
      }
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ ok: true, ingested: 2 });

    expect(db.pool.query).toHaveBeenCalledTimes(1);

    const [sql, params] = (db.pool.query as any).mock.calls[0];
    expect(String(sql)).toContain('INSERT INTO query_logs');
    expect(String(sql)).toContain('jsonb_array_elements');
    expect(Array.isArray(params)).toBe(true);
    expect(typeof params[0]).toBe('string');

    await app.close();
  });
});
