import type { FastifyInstance } from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';
import '@fastify/rate-limit';

type DnsQuery = Record<string, unknown> & { id: string };

type QueryLogsGetQuerystring = {
  limit?: string;
};

export async function registerQueryLogsRoutes(app: FastifyInstance, config: AppConfig, db: Db): Promise<void> {
  app.get(
    '/api/query-logs',
    {
      preHandler: app.rateLimit({ max: 120, timeWindow: '1 minute' })
    },
    async (request: FastifyRequest<{ Querystring: QueryLogsGetQuerystring }>) => {
      await requireAdmin(db, request);
      const limitRaw = Number(request.query.limit ?? '250');
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 250;

      const res = await db.pool.query(
        'SELECT id, ts, entry FROM query_logs ORDER BY ts DESC, id DESC LIMIT $1',
        [limit]
      );

      return {
        items: res.rows.map((r) => ({
          ...(r.entry ?? {}),
          _db: { id: String(r.id), ts: r.ts }
        }))
      };
    }
  );

  app.post(
    '/api/query-logs/ingest',
    {
      preHandler: app.rateLimit({ max: 30, timeWindow: '1 minute' }),
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            items: {
              type: 'array',
              minItems: 1,
              maxItems: 2000,
              items: { type: 'object', additionalProperties: true }
            },
            item: { type: 'object', additionalProperties: true }
          }
        }
      }
    },
    async (
      request: FastifyRequest<{ Body: { items?: DnsQuery[]; item?: DnsQuery } }>,
      reply: FastifyReply
    ) => {
      await requireAdmin(db, request);

      const entries = Array.isArray(request.body.items)
        ? request.body.items
        : request.body.item
          ? [request.body.item]
          : [];

      if (entries.length === 0) {
        reply.code(400);
        return { error: 'NO_ITEMS', message: 'Provide body.items[] or body.item.' };
      }

      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        for (const entry of entries) {
          await client.query('INSERT INTO query_logs(entry) VALUES ($1)', [entry]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      reply.code(202);
      return { ok: true, ingested: entries.length };
    }
  );
}
