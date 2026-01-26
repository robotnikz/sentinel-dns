import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';
import 'fastify-rate-limit';

type SummaryQuerystring = {
  hours?: string;
};

type TimeseriesQuerystring = {
  hours?: string;
};

type TopQuerystring = {
  hours?: string;
  limit?: string;
  excludeUpstreams?: string;
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

function parseBool(value: unknown): boolean {
  const v = String(value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function extractHostFromDohUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.hostname ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function getUpstreamDomainsToExclude(db: Db): Promise<Set<string>> {
  const res = await db.pool.query('SELECT value FROM settings WHERE key = $1', ['dns_settings']);
  const value = res.rows?.[0]?.value;
  const settings = typeof value === 'object' && value ? (value as any) : {};
  const mode = settings.upstreamMode === 'forward' ? 'forward' : 'unbound';
  if (mode !== 'forward') return new Set();

  const forward = typeof settings.forward === 'object' && settings.forward ? (settings.forward as any) : {};
  const transport =
    forward.transport === 'doh'
      ? 'doh'
      : forward.transport === 'dot'
        ? 'dot'
        : forward.transport === 'tcp'
          ? 'tcp'
          : 'udp';

  const out = new Set<string>();
  if (transport === 'doh') {
    const dohUrl = typeof forward.dohUrl === 'string' ? forward.dohUrl.trim() : '';
    const host = dohUrl ? extractHostFromDohUrl(dohUrl) : null;
    if (host) out.add(host);
    return out;
  }

  const host = typeof forward.host === 'string' ? forward.host.trim().toLowerCase() : '';
  // host might be an IP; we only exclude DNS-like hostnames.
  if (host && /[a-z]/i.test(host) && host.includes('.')) out.add(host);
  return out;
}

export async function registerMetricsRoutes(app: FastifyInstance, config: AppConfig, db: Db): Promise<void> {
  app.get(
    '/api/metrics/clients',
    {
      config: {
        rateLimit: { max: 120, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit()
    },
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
    {
      config: {
        rateLimit: { max: 120, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit()
    },
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
    {
      config: {
        rateLimit: { max: 120, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit()
    },
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
    {
      config: {
        rateLimit: { max: 120, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit()
    },
    async (request: FastifyRequest<{ Querystring: TimeseriesQuerystring }>) => {
      await requireAdmin(db, request);
      const hours = clampInt(request.query.hours, 24, 1, 168);

      // Smaller buckets for small windows so the timeline isn't just 1-6 points.
      const bucketSeconds = hours <= 1 ? 5 * 60 : hours <= 6 ? 15 * 60 : 60 * 60;
      const bucketIntervalSql = bucketSeconds === 300 ? "interval '5 minutes'" : bucketSeconds === 900 ? "interval '15 minutes'" : "interval '1 hour'";

      // Epoch-based bucketing (UTC) with zero-fill.
      const res = await db.pool.query(
        `WITH bounds AS (
           SELECT NOW() AS end_ts,
                  NOW() - ($1::text || ' hours')::interval AS start_ts
         ),
         buckets AS (
           SELECT generate_series(
             to_timestamp(floor(extract(epoch from (SELECT start_ts FROM bounds)) / ${bucketSeconds})::bigint * ${bucketSeconds}),
             to_timestamp(floor(extract(epoch from (SELECT end_ts FROM bounds)) / ${bucketSeconds})::bigint * ${bucketSeconds}),
             ${bucketIntervalSql}
           ) AS bucket
         ),
         agg AS (
           SELECT to_timestamp(floor(extract(epoch from ts) / ${bucketSeconds})::bigint * ${bucketSeconds}) AS bucket,
                  COUNT(*)::bigint AS queries,
                  SUM(CASE WHEN entry->>'status' = 'BLOCKED' THEN 1 ELSE 0 END)::bigint AS ads
           FROM query_logs
           WHERE ts >= (SELECT start_ts FROM bounds)
             AND ts <= (SELECT end_ts FROM bounds)
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
    {
      config: {
        rateLimit: { max: 120, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit()
    },
    async (request: FastifyRequest<{ Querystring: TopQuerystring }>) => {
      await requireAdmin(db, request);
      const hours = clampInt(request.query.hours, 24, 1, 168);
      const limit = clampInt(request.query.limit, 10, 1, 100);
      const excludeUpstreams = parseBool(request.query.excludeUpstreams);

      const upstreamDomains = excludeUpstreams ? await getUpstreamDomainsToExclude(db) : new Set<string>();

      const queryLimit = upstreamDomains.size > 0 ? Math.min(100, Math.max(limit, limit * 3)) : limit;

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
        [String(hours), queryLimit]
      );

      return {
        windowHours: hours,
        items: res.rows
          .filter((r) => typeof r.domain === 'string' && r.domain.length > 0)
          .map((r) => ({ domain: String(r.domain), count: Number(r.count ?? 0) }))
          .filter((r) => {
            if (upstreamDomains.size === 0) return true;
            const d = r.domain.trim().toLowerCase();
            return d && !upstreamDomains.has(d);
          })
          .slice(0, limit)
      };
    }
  );

  app.get(
    '/api/metrics/top-blocked',
    {
      config: {
        rateLimit: { max: 120, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit()
    },
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
