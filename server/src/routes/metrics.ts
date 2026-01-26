import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';

type SummaryQuerystring = {
  hours?: string;
};

type TimeseriesQuerystring = {
  hours?: string;
};

type TopQuerystring = {
  hours?: string;
  limit?: string;
};

type ClientsQuerystring = {
  hours?: string;
  limit?: string;
};

type ClientDetailQuerystring = {
  hours?: string;
  limit?: string;
  client?: string;
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export async function registerMetricsRoutes(app: FastifyInstance, config: AppConfig, db: Db): Promise<void> {
  app.get(
    '/api/metrics/clients',
    async (request: FastifyRequest<{ Querystring: ClientsQuerystring }>) => {
      await requireAdmin(db, request);
      const hours = clampInt(request.query.hours, 24, 1, 168);
      const limit = clampInt(request.query.limit, 200, 1, 500);

      const res = await db.pool.query(
        `SELECT
           COALESCE(NULLIF(entry->>'clientIp',''), NULLIF(entry->>'client',''), 'Unknown') AS client,
           COUNT(*)::bigint AS total,
           SUM(CASE WHEN entry->>'status' IN ('BLOCKED','SHADOW_BLOCKED') THEN 1 ELSE 0 END)::bigint AS blocked,
           MAX(ts) AS last_seen,
           COUNT(DISTINCT NULLIF(entry->>'domain',''))::bigint AS unique_domains
         FROM query_logs
         WHERE ts >= NOW() - ($1::text || ' hours')::interval
         GROUP BY 1
         ORDER BY total DESC
         LIMIT $2`,
        [String(hours), limit]
      );

      return {
        windowHours: hours,
        items: res.rows.map((r) => ({
          client: String(r.client ?? 'Unknown'),
          totalQueries: Number(r.total ?? 0),
          blockedQueries: Number(r.blocked ?? 0),
          uniqueDomains: Number(r.unique_domains ?? 0),
          lastSeen: r.last_seen ? (r.last_seen as Date).toISOString() : null
        }))
      };
    }
  );

  app.get(
    '/api/metrics/client-detail',
    async (request: FastifyRequest<{ Querystring: ClientDetailQuerystring }>) => {
      await requireAdmin(db, request);
      const hours = clampInt(request.query.hours, 24, 1, 168);
      const limit = clampInt(request.query.limit, 10, 1, 50);
      const client = typeof request.query.client === 'string' ? request.query.client.trim() : '';

      if (!client) {
        return { error: 'MISSING_CLIENT', message: 'Provide querystring client.' };
      }

      const topAllowedRes = await db.pool.query(
        `SELECT entry->>'domain' AS domain, COUNT(*)::bigint AS count
         FROM query_logs
         WHERE ts >= NOW() - ($1::text || ' hours')::interval
           AND COALESCE(NULLIF(entry->>'clientIp',''), NULLIF(entry->>'client',''), 'Unknown') = $2
           AND COALESCE(entry->>'status','') NOT IN ('BLOCKED', 'SHADOW_BLOCKED')
           AND entry ? 'domain'
           AND NULLIF(entry->>'domain','') IS NOT NULL
         GROUP BY 1
         ORDER BY count DESC
         LIMIT $3`,
        [String(hours), client, limit]
      );

      const topBlockedRes = await db.pool.query(
        `SELECT entry->>'domain' AS domain, COUNT(*)::bigint AS count
         FROM query_logs
         WHERE ts >= NOW() - ($1::text || ' hours')::interval
           AND COALESCE(NULLIF(entry->>'clientIp',''), NULLIF(entry->>'client',''), 'Unknown') = $2
           AND entry->>'status' IN ('BLOCKED', 'SHADOW_BLOCKED')
           AND entry ? 'domain'
           AND NULLIF(entry->>'domain','') IS NOT NULL
         GROUP BY 1
         ORDER BY count DESC
         LIMIT $3`,
        [String(hours), client, limit]
      );

      return {
        windowHours: hours,
        client,
        topAllowed: topAllowedRes.rows
          .filter((r) => typeof r.domain === 'string' && r.domain.length > 0)
          .map((r) => ({ domain: String(r.domain), count: Number(r.count ?? 0) })),
        topBlocked: topBlockedRes.rows
          .filter((r) => typeof r.domain === 'string' && r.domain.length > 0)
          .map((r) => ({ domain: String(r.domain), count: Number(r.count ?? 0) }))
      };
    }
  );

  app.get(
    '/api/metrics/summary',
    async (request: FastifyRequest<{ Querystring: SummaryQuerystring }>) => {
      await requireAdmin(db, request);
      const hours = clampInt(request.query.hours, 24, 1, 168);

      const totalRes = await db.pool.query(
        `SELECT COUNT(*)::bigint AS total
         FROM query_logs
         WHERE ts >= NOW() - ($1::text || ' hours')::interval`,
        [String(hours)]
      );

      const blockedRes = await db.pool.query(
        `SELECT COUNT(*)::bigint AS blocked
         FROM query_logs
         WHERE ts >= NOW() - ($1::text || ' hours')::interval
           AND entry->>'status' IN ('BLOCKED', 'SHADOW_BLOCKED')`,
        [String(hours)]
      );

      const clientsRes = await db.pool.query(
        `SELECT COUNT(DISTINCT COALESCE(NULLIF(entry->>'clientIp',''), NULLIF(entry->>'client','')))::bigint AS clients
         FROM query_logs
         WHERE ts >= NOW() - ($1::text || ' hours')::interval`,
        [String(hours)]
      );

      return {
        windowHours: hours,
        totalQueries: Number(totalRes.rows[0]?.total ?? 0),
        blockedQueries: Number(blockedRes.rows[0]?.blocked ?? 0),
        activeClients: Number(clientsRes.rows[0]?.clients ?? 0)
      };
    }
  );

  app.get(
    '/api/metrics/timeseries',
    async (request: FastifyRequest<{ Querystring: TimeseriesQuerystring }>) => {
      await requireAdmin(db, request);
      const hours = clampInt(request.query.hours, 24, 1, 168);

      // Hour buckets with zero-fill.
      const res = await db.pool.query(
        `WITH bounds AS (
           SELECT date_trunc('hour', NOW()) AS end_ts,
                  date_trunc('hour', NOW()) - ($1::text || ' hours')::interval + interval '1 hour' AS start_ts
         ),
         buckets AS (
           SELECT generate_series((SELECT start_ts FROM bounds), (SELECT end_ts FROM bounds), interval '1 hour') AS bucket
         ),
         agg AS (
           SELECT date_trunc('hour', ts) AS bucket,
                  COUNT(*)::bigint AS queries,
                  SUM(CASE WHEN entry->>'status' = 'BLOCKED' THEN 1 ELSE 0 END)::bigint AS ads
           FROM query_logs
           WHERE ts >= (SELECT start_ts FROM bounds)
             AND ts <= (SELECT end_ts FROM bounds) + interval '59 minutes 59 seconds'
           GROUP BY 1
         )
         SELECT b.bucket,
                COALESCE(a.queries, 0)::bigint AS queries,
                COALESCE(a.ads, 0)::bigint AS ads
         FROM buckets b
         LEFT JOIN agg a USING(bucket)
         ORDER BY b.bucket ASC`,
        [String(hours)]
      );

      return {
        windowHours: hours,
        items: res.rows.map((r) => ({
          ts: (r.bucket as Date).toISOString(),
          queries: Number(r.queries ?? 0),
          ads: Number(r.ads ?? 0)
        }))
      };
    }
  );

  app.get(
    '/api/metrics/top-domains',
    async (request: FastifyRequest<{ Querystring: TopQuerystring }>) => {
      await requireAdmin(db, request);
      const hours = clampInt(request.query.hours, 24, 1, 168);
      const limit = clampInt(request.query.limit, 10, 1, 100);

      const res = await db.pool.query(
        `SELECT entry->>'domain' AS domain, COUNT(*)::bigint AS count
         FROM query_logs
         WHERE ts >= NOW() - ($1::text || ' hours')::interval
           AND COALESCE(entry->>'status','') NOT IN ('BLOCKED', 'SHADOW_BLOCKED')
           AND entry ? 'domain'
           AND NULLIF(entry->>'domain','') IS NOT NULL
         GROUP BY 1
         ORDER BY count DESC
         LIMIT $2`,
        [String(hours), limit]
      );

      return {
        windowHours: hours,
        items: res.rows
          .filter((r) => typeof r.domain === 'string' && r.domain.length > 0)
          .map((r) => ({ domain: String(r.domain), count: Number(r.count ?? 0) }))
      };
    }
  );

  app.get(
    '/api/metrics/top-blocked',
    async (request: FastifyRequest<{ Querystring: TopQuerystring }>) => {
      await requireAdmin(db, request);
      const hours = clampInt(request.query.hours, 24, 1, 168);
      const limit = clampInt(request.query.limit, 10, 1, 100);

      const res = await db.pool.query(
        `SELECT entry->>'domain' AS domain, COUNT(*)::bigint AS count
         FROM query_logs
         WHERE ts >= NOW() - ($1::text || ' hours')::interval
           AND entry->>'status' IN ('BLOCKED', 'SHADOW_BLOCKED')
           AND entry ? 'domain'
           AND NULLIF(entry->>'domain','') IS NOT NULL
         GROUP BY 1
         ORDER BY count DESC
         LIMIT $2`,
        [String(hours), limit]
      );

      return {
        windowHours: hours,
        items: res.rows
          .filter((r) => typeof r.domain === 'string' && r.domain.length > 0)
          .map((r) => ({ domain: String(r.domain), count: Number(r.count ?? 0) }))
      };
    }
  );

  void config;
}
