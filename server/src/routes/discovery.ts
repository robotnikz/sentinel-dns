import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';
import 'fastify-rate-limit';

export type DiscoverySettings = {
  reverseDns: {
    enabled: boolean;
    /** Optional DNS server IP (e.g. OPNsense/Unbound IP). If empty, system resolver is used. */
    resolver?: string;
    timeoutMs?: number;
  };
};

const DEFAULT_SETTINGS: DiscoverySettings = {
  reverseDns: {
    enabled: false,
    resolver: '',
    timeoutMs: 250
  }
};

function normalizeDiscoverySettings(input: any): DiscoverySettings {
  const v = input && typeof input === 'object' ? input : {};
  const rd = v.reverseDns && typeof v.reverseDns === 'object' ? v.reverseDns : {};

  const enabled = rd.enabled === true;
  const resolver = typeof rd.resolver === 'string' ? rd.resolver.trim() : '';
  const timeoutRaw = Number(rd.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutRaw) ? Math.max(50, Math.min(2000, Math.floor(timeoutRaw))) : 250;

  return {
    reverseDns: { enabled, resolver, timeoutMs }
  };
}

type CacheEntry = { hostname: string | null; expiresAt: number };
const PTR_CACHE = new Map<string, CacheEntry>();

function stripTrailingDot(name: string): string {
  return name.endsWith('.') ? name.slice(0, -1) : name;
}

async function runPtrLookup(
  ip: string,
  resolverIp: string,
  timeoutMs: number
): Promise<{ names: string[]; timedOut: boolean; durationMs: number }> {
  const startedAt = Date.now();
  const safeTimeoutMs = Number.isFinite(timeoutMs)
    ? Math.max(50, Math.min(2000, Math.floor(timeoutMs)))
    : 250;

  const doLookup = async () => {
    const r = new Resolver();
    if (resolverIp) r.setServers([resolverIp]);
    const names = await r.reverse(ip);
    const normalized = (Array.isArray(names) ? names : [])
      .map((n) => stripTrailingDot(String(n)))
      .map((n) => n.trim())
      .filter(Boolean);
    // Deduplicate while keeping order
    return Array.from(new Set(normalized));
  };

  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('TIMEOUT')), safeTimeoutMs);
    });
    const names = await Promise.race([doLookup(), timeout]);
    return { names, timedOut: false, durationMs: Date.now() - startedAt };
  } catch (err: any) {
    const timedOut = String(err?.message || '').toUpperCase() === 'TIMEOUT';
    return { names: [], timedOut, durationMs: Date.now() - startedAt };
  } finally {
    // Ensure we don't keep stray timers around if the lookup wins the race.
    if (timer) clearTimeout(timer);
  }
}

async function resolvePtrHostname(ip: string, resolverIp: string, timeoutMs: number): Promise<string | null> {
  const now = Date.now();
  const hit = PTR_CACHE.get(ip);
  if (hit && hit.expiresAt > now) return hit.hostname;

  const safeTimeoutMs = Number.isFinite(timeoutMs)
    ? Math.max(50, Math.min(2000, Math.floor(timeoutMs)))
    : 250;

  const run = async () => {
    const r = new Resolver();
    if (resolverIp) r.setServers([resolverIp]);

    try {
      const names = await r.reverse(ip);
      const best = Array.isArray(names) && names.length ? stripTrailingDot(String(names[0])) : '';
      return best || null;
    } catch {
      return null;
    }
  };

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), safeTimeoutMs);
  });
  const hostname = await Promise.race([run(), timeout]);
  if (timer) clearTimeout(timer);

  // Cache: positives longer than negatives.
  PTR_CACHE.set(ip, {
    hostname,
    expiresAt: now + (hostname ? 10 * 60_000 : 60_000)
  });

  return hostname;
}

export async function registerDiscoveryRoutes(app: FastifyInstance, config: AppConfig, db: Db): Promise<void> {
  app.get(
    '/api/discovery/settings',
    {
      config: {
        rateLimit: { max: 120, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit()
    },
    async (request, reply) => {
      await requireAdmin(db, request);
      const res = await db.pool.query('SELECT value FROM settings WHERE key = $1', ['discovery_settings']);
      return { value: normalizeDiscoverySettings(res.rows?.[0]?.value) };
    }
  );

  app.post(
    '/api/discovery/test-ptr',
    {
      config: {
        rateLimit: { max: 60, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit(),
      schema: {
        body: {
          type: 'object',
          additionalProperties: true,
          properties: {
            ip: { type: 'string' },
            resolver: { type: 'string' },
            timeoutMs: { type: 'number' }
          },
          required: ['ip']
        }
      }
    },
    async (request: FastifyRequest<{ Body: { ip: string; resolver?: string; timeoutMs?: number } }>, reply: FastifyReply) => {
      await requireAdmin(db, request);

      const ip = String(request.body?.ip ?? '').trim();
      if (!ip || isIP(ip) === 0) {
        reply.code(400);
        return { error: 'INVALID_IP' };
      }

      // Allow testing with unsaved UI values (resolver/timeout can be provided in the request).
      const settingsRes = await db.pool.query('SELECT value FROM settings WHERE key = $1', ['discovery_settings']);
      const settings = normalizeDiscoverySettings(settingsRes.rows?.[0]?.value);

      const resolverRaw = typeof request.body?.resolver === 'string' ? request.body.resolver.trim() : '';
      const timeoutRaw = Number(request.body?.timeoutMs);

      const resolverIp = resolverRaw || (settings.reverseDns.resolver ?? '') || '';
      const timeoutMs = Number.isFinite(timeoutRaw)
        ? Math.max(50, Math.min(2000, Math.floor(timeoutRaw)))
        : settings.reverseDns.timeoutMs ?? 250;

      const result = await runPtrLookup(ip, resolverIp, timeoutMs);

      return {
        ip,
        resolver: resolverIp,
        timeoutMs,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        names: result.names,
        hostname: result.names[0] ?? null
      };
    }
  );

  app.put(
    '/api/discovery/settings',
    {
      config: {
        rateLimit: { max: 60, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit(),
      schema: {
        body: {
          type: 'object',
          additionalProperties: true
        }
      }
    },
    async (request: FastifyRequest<{ Body: DiscoverySettings }>, reply: FastifyReply) => {
      await requireAdmin(db, request);

      const normalized = normalizeDiscoverySettings(request.body);
      await db.pool.query(
        'INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
        ['discovery_settings', normalized]
      );

      return { ok: true, value: normalized };
    }
  );

  app.get(
    '/api/discovery/clients',
    {
      config: {
        rateLimit: { max: 120, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit()
    },
    async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
      await requireAdmin(db, request);

      const limitRaw = Number(request.query.limit ?? '200');
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : 200;

      const settingsRes = await db.pool.query('SELECT value FROM settings WHERE key = $1', ['discovery_settings']);
      const settings = normalizeDiscoverySettings(settingsRes.rows?.[0]?.value);

      const res = await db.pool.query(
        `SELECT entry->>'clientIp' AS ip, MAX(ts) AS last_seen
         FROM query_logs
         WHERE entry ? 'clientIp'
         GROUP BY entry->>'clientIp'
         ORDER BY last_seen DESC
         LIMIT $1`,
        [limit]
      );

      const rows = res.rows
        .map((r) => ({
          ip: typeof r.ip === 'string' ? r.ip : String(r.ip ?? ''),
          lastSeen: r.last_seen ? new Date(r.last_seen).toISOString() : null
        }))
        .filter((r) => !!r.ip && r.ip !== '0.0.0.0');

      if (!settings.reverseDns.enabled) {
        return { items: rows.map((r) => ({ ...r, hostname: null, source: 'observed' })) };
      }

      const resolverIp = settings.reverseDns.resolver ?? '';
      const timeoutMs = settings.reverseDns.timeoutMs ?? 250;

      // Concurrency limit so we don't blast the resolver.
      const concurrency = 10;
      const out: Array<{ ip: string; lastSeen: string | null; hostname: string | null; source: string }> = [];

      for (let i = 0; i < rows.length; i += concurrency) {
        const batch = rows.slice(i, i + concurrency);
        const resolved = await Promise.all(
          batch.map(async (r) => ({
            ...r,
            hostname: await resolvePtrHostname(r.ip, resolverIp, timeoutMs)
          }))
        );
        for (const r of resolved) {
          out.push({ ...r, source: 'reverse-dns' });
        }
      }

      return { items: out };
    }
  );
}
