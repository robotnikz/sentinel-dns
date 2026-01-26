import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';
import '@fastify/rate-limit';

export async function registerSettingsRoutes(app: FastifyInstance, config: AppConfig, db: Db): Promise<void> {
  app.get(
    '/api/settings',
    {
      preHandler: app.rateLimit({ max: 120, timeWindow: '1 minute' })
    },
    async (request) => {
      await requireAdmin(db, request);
      const res = await db.pool.query('SELECT key, value, updated_at FROM settings');
      return { items: res.rows };
    }
  );

  app.put(
    '/api/settings/:key',
    {
      preHandler: app.rateLimit({ max: 60, timeWindow: '1 minute' }),
      schema: {
        body: {
          type: 'object'
        }
      }
    },
    async (request) => {
      await requireAdmin(db, request);
      const key = (request.params as any).key as string;
      const value = request.body;

      await db.pool.query(
        'INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
        [key, value]
      );

      return { ok: true };
    }
  );
}
