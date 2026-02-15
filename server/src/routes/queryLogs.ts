import type { FastifyInstance } from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';
import 'fastify-rate-limit';

type DnsQuery = Record<string, unknown> & { id: string };

type QueryLogsGetQuerystring = {
  limit?: string;
  hours?: string;
  domain?: string;
  status?: string;
};

type IgnoredAnomaliesPutBody = {
  signature: string;
};

type IgnoredAnomaliesDeleteQuerystring = {
  signature?: string;
};

export async function registerQueryLogsRoutes(app: FastifyInstance, config: AppConfig, db: Db): Promise<void> {
  const purgeExpiredIgnored = async () => {
    // Best-effort retention cleanup. Called on access so we don't need a cron.
    await db.pool.query("DELETE FROM ignored_anomalies WHERE ignored_at < NOW() - interval '30 days'");
  };

  app.get(
    '/api/suspicious/ignored',
    {
      config: {
        rateLimit: { max: 120, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit()
    },
    async (request) => {
      await requireAdmin(db, request);
      await purgeExpiredIgnored();

      const res = await db.pool.query(
        'SELECT signature, ignored_at FROM ignored_anomalies ORDER BY ignored_at DESC'
      );

      return {
        items: res.rows.map((r) => ({
          signature: String(r.signature ?? ''),
          ignoredAt: r.ignored_at ? new Date(r.ignored_at).toISOString() : null
        }))
      };
    }
  );

  app.put(
    '/api/suspicious/ignored',
    {
      config: {
        rateLimit: { max: 60, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit(),
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['signature'],
          properties: {
            signature: { type: 'string', minLength: 1, maxLength: 500 }
          }
        }
      }
    },
    async (request: FastifyRequest<{ Body: IgnoredAnomaliesPutBody }>) => {
      await requireAdmin(db, request);
      await purgeExpiredIgnored();

      const signature = String(request.body.signature || '').trim();
      if (!signature) return { error: 'INVALID_SIGNATURE' };

      await db.pool.query(
        'INSERT INTO ignored_anomalies(signature, ignored_at) VALUES ($1, NOW()) ON CONFLICT (signature) DO UPDATE SET ignored_at = NOW()',
        [signature]
      );

      return { ok: true };
    }
  );

  app.delete(
    '/api/suspicious/ignored',
    {
      config: {
        rateLimit: { max: 60, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit()
    },
    async (request: FastifyRequest<{ Querystring: IgnoredAnomaliesDeleteQuerystring }>, reply: FastifyReply) => {
      await requireAdmin(db, request);
      const signature = String(request.query.signature || '').trim();
      if (!signature) {
        reply.code(400);
        return { error: 'INVALID_SIGNATURE' };
      }

      await db.pool.query('DELETE FROM ignored_anomalies WHERE signature = $1', [signature]);
      reply.code(204);
      return null;
    }
  );

  app.get(
    '/api/query-logs',
    {
        config: {
          rateLimit: { max: 120, timeWindow: '1 minute' }
        },
        preHandler: app.rateLimit()
    },
    async (request: FastifyRequest<{ Querystring: QueryLogsGetQuerystring }>) => {
      await requireAdmin(db, request);
      const limitRaw = Number(request.query.limit ?? '250');
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, limitRaw)) : 250;

      const hoursRaw = Number(request.query.hours ?? '');
      const hours = Number.isFinite(hoursRaw) ? Math.max(1, Math.min(168, hoursRaw)) : null;

      const domain = String(request.query.domain ?? '').trim();
      const statusRaw = String(request.query.status ?? '').trim().toUpperCase();
      const status =
        statusRaw === 'BLOCKED' ||
        statusRaw === 'PERMITTED' ||
        statusRaw === 'SHADOW_BLOCKED' ||
        statusRaw === 'CACHED'
          ? statusRaw
          : null;

      const where: string[] = [];
      const params: Array<string | number> = [];

      if (hours !== null) {
        params.push(String(hours));
        where.push(`ts >= NOW() - ($${params.length}::text || ' hours')::interval`);
      }
      if (domain) {
        params.push(domain);
        where.push(`LOWER(entry->>'domain') = LOWER($${params.length})`);
      }
      if (status) {
        if (status === 'BLOCKED') {
          where.push(`entry->>'status' IN ('BLOCKED', 'SHADOW_BLOCKED')`);
        } else {
          params.push(status);
          where.push(`entry->>'status' = $${params.length}`);
        }
      }

      params.push(limit);
      const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

      const res = await db.pool.query(
        `SELECT id, ts, entry FROM query_logs ${whereSql} ORDER BY ts DESC, id DESC LIMIT $${params.length}`,
        params
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
    '/api/query-logs/flush',
    {
      config: {
        rateLimit: { max: 10, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit()
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      await requireAdmin(db, _request);

      const res = await db.pool.query('DELETE FROM query_logs');
      return {
        ok: true,
        deleted: typeof res.rowCount === 'number' ? res.rowCount : 0
      };
    }
  );

  app.post(
    '/api/query-logs/ingest',
    {
        config: {
          rateLimit: { max: 30, timeWindow: '1 minute' }
        },
        preHandler: app.rateLimit(),
      // Defense-in-depth: avoid excessively large JSON bodies.
      // Needs to be high enough for normal ingest bursts.
      bodyLimit: 5 * 1024 * 1024,
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

      // Batch insert for performance: avoid N roundtrips for large ingest payloads.
      // We pass a JSON array and let Postgres expand it server-side.
      await db.pool.query(
        `INSERT INTO query_logs(entry)
         SELECT value
         FROM jsonb_array_elements($1::jsonb) AS value`,
        [JSON.stringify(entries)]
      );

      reply.code(202);
      return { ok: true, ingested: entries.length };
    }
  );

  void config;
}
