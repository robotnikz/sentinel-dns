import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';
import 'fastify-rate-limit';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

function readAppVersion(): string {
  const envVersion = String(process.env.SENTINEL_VERSION || '').trim();
  if (envVersion) return envVersion;

  try {
    const pkg = require('../../../package.json') as { version?: string };
    const v = String(pkg?.version || '').trim();
    return v || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function runSupervisorCtl(args: string[]): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  if (process.platform === 'win32') return { ok: false, error: 'NOT_SUPPORTED_ON_WINDOWS' };
  try {
    const res = await execFileAsync('supervisorctl', args, { timeout: 5000 });
    return { ok: true, stdout: String(res.stdout || '').trim() };
  } catch (e: any) {
    const msg = String(e?.stderr || e?.message || e);
    return { ok: false, error: msg };
  }
}

export async function registerMaintenanceRoutes(app: FastifyInstance, config: AppConfig, db: Db): Promise<void> {
  app.post(
    '/api/maintenance/query-logs/purge',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: app.rateLimit(),
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['olderThanDays'],
          properties: {
            olderThanDays: { type: 'number', minimum: 0, maximum: 3650 }
          }
        }
      }
    },
    async (request: FastifyRequest<{ Body: { olderThanDays: number } }>, reply: FastifyReply) => {
      await requireAdmin(db, request);

      const daysRaw = Number(request.body.olderThanDays);
      const days = Number.isFinite(daysRaw) ? Math.max(0, Math.floor(daysRaw)) : 0;
      if (days <= 0) {
        reply.code(400);
        return { error: 'INVALID_DAYS', message: 'olderThanDays must be >= 1.' };
      }

      const res = await db.pool.query(
        `DELETE FROM query_logs WHERE ts < NOW() - ($1::text || ' days')::interval`,
        [String(days)]
      );

      return { ok: true, deleted: typeof res.rowCount === 'number' ? res.rowCount : 0 };
    }
  );

  app.post(
    '/api/maintenance/notifications/clear',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: app.rateLimit(),
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['mode'],
          properties: {
            mode: { type: 'string', enum: ['all', 'read'] }
          }
        }
      }
    },
    async (request: FastifyRequest<{ Body: { mode: 'all' | 'read' } }>) => {
      await requireAdmin(db, request);
      const mode = request.body.mode;

      const res =
        mode === 'read'
          ? await db.pool.query('DELETE FROM notifications WHERE read = TRUE')
          : await db.pool.query('DELETE FROM notifications');

      return { ok: true, deleted: typeof res.rowCount === 'number' ? res.rowCount : 0 };
    }
  );

  app.post(
    '/api/maintenance/ignored-anomalies/clear',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: app.rateLimit(),
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['mode'],
          properties: {
            mode: { type: 'string', enum: ['all', 'expired'] }
          }
        }
      }
    },
    async (request: FastifyRequest<{ Body: { mode: 'all' | 'expired' } }>) => {
      await requireAdmin(db, request);
      const mode = request.body.mode;

      const res =
        mode === 'expired'
          ? await db.pool.query("DELETE FROM ignored_anomalies WHERE ignored_at < NOW() - interval '30 days'")
          : await db.pool.query('DELETE FROM ignored_anomalies');

      return { ok: true, deleted: typeof res.rowCount === 'number' ? res.rowCount : 0 };
    }
  );

  app.get(
    '/api/maintenance/export',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: app.rateLimit()
    },
    async (request, reply) => {
      await requireAdmin(db, request);

      const [settingsRes, rulesRes, clientsRes, blocklistsRes] = await Promise.all([
        db.pool.query('SELECT key, value, updated_at FROM settings ORDER BY key ASC'),
        db.pool.query('SELECT id, domain, type, category, created_at FROM rules ORDER BY id ASC'),
        db.pool.query('SELECT id, profile, updated_at FROM clients ORDER BY id ASC'),
        db.pool.query(
          'SELECT id, name, url, enabled, mode, last_updated_at, last_error, last_rule_count, created_at, updated_at FROM blocklists ORDER BY id ASC'
        )
      ]);

      const payload = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        appVersion: readAppVersion(),
        data: {
          settings: settingsRes.rows,
          rules: rulesRes.rows,
          clients: clientsRes.rows,
          blocklists: blocklistsRes.rows
        }
      };

      const download = String((request.query as any)?.download || '').toLowerCase();
      if (download === '1' || download === 'true') {
        reply.header('content-type', 'application/json; charset=utf-8');
        reply.header('content-disposition', `attachment; filename="sentinel-export-${new Date().toISOString().slice(0, 10)}.json"`);
      }

      return payload;
    }
  );

  app.post(
    '/api/maintenance/import',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: app.rateLimit(),
      bodyLimit: 10 * 1024 * 1024,
      schema: {
        body: {
          type: 'object',
          additionalProperties: true
        }
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await requireAdmin(db, request);

      const body: any = request.body ?? {};
      const dryRun = body?.dryRun !== false;

      const data = body?.data ?? body;
      const settings = Array.isArray(data?.settings) ? data.settings : [];
      const rules = Array.isArray(data?.rules) ? data.rules : [];
      const clients = Array.isArray(data?.clients) ? data.clients : [];
      const blocklists = Array.isArray(data?.blocklists) ? data.blocklists : [];

      // Basic validation
      const invalid = (reason: string) => {
        reply.code(400);
        return { error: 'INVALID_IMPORT', message: reason };
      };

      for (const s of settings) {
        if (!s || typeof s.key !== 'string') return invalid('settings[].key must be string');
      }
      for (const r of rules) {
        if (!r || typeof r.domain !== 'string' || typeof r.type !== 'string') return invalid('rules[] invalid');
      }
      for (const c of clients) {
        if (!c || typeof c.id !== 'string' || typeof c.profile !== 'object') return invalid('clients[] invalid');
      }
      for (const b of blocklists) {
        if (!b || typeof b.url !== 'string' || typeof b.name !== 'string') return invalid('blocklists[] invalid');
      }

      // Estimate updates vs inserts
      const existingSettings = await db.pool.query('SELECT key FROM settings');
      const existingRules = await db.pool.query('SELECT domain, type, category FROM rules');
      const existingClients = await db.pool.query('SELECT id FROM clients');
      const existingBlocklists = await db.pool.query('SELECT url FROM blocklists');

      const settingsKeys = new Set(existingSettings.rows.map((r) => String(r.key)));
      const clientIds = new Set(existingClients.rows.map((r) => String(r.id)));
      const blocklistUrls = new Set(existingBlocklists.rows.map((r) => String(r.url)));
      const ruleKeys = new Set(existingRules.rows.map((r) => `${String(r.domain)}|${String(r.type)}|${String(r.category ?? 'Manual')}`));

      const summary = {
        settings: {
          total: settings.length,
          wouldUpdate: settings.filter((s: any) => settingsKeys.has(String(s.key))).length,
          wouldInsert: settings.filter((s: any) => !settingsKeys.has(String(s.key))).length
        },
        rules: {
          total: rules.length,
          wouldInsert: rules.filter((r: any) => !ruleKeys.has(`${String(r.domain)}|${String(r.type)}|${String(r.category ?? 'Manual')}`)).length
        },
        clients: {
          total: clients.length,
          wouldUpdate: clients.filter((c: any) => clientIds.has(String(c.id))).length,
          wouldInsert: clients.filter((c: any) => !clientIds.has(String(c.id))).length
        },
        blocklists: {
          total: blocklists.length,
          wouldUpdate: blocklists.filter((b: any) => blocklistUrls.has(String(b.url))).length,
          wouldInsert: blocklists.filter((b: any) => !blocklistUrls.has(String(b.url))).length
        }
      };

      if (dryRun) {
        return { ok: true, dryRun: true, summary };
      }

      // Apply (best-effort upserts). Keep it safe: no deletes.
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');

        for (const s of settings) {
          const key = String(s.key).trim();
          if (!key) continue;
          const value = (s as any).value;
          await client.query(
            `INSERT INTO settings(key, value, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [key, value]
          );
        }

        for (const c of clients) {
          const id = String(c.id).trim();
          if (!id) continue;
          const profile = (c as any).profile;
          await client.query(
            `INSERT INTO clients(id, profile, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = NOW()`,
            [id, profile]
          );
        }

        for (const b of blocklists) {
          const name = String(b.name).trim();
          const url = String(b.url).trim();
          if (!name || !url) continue;
          const enabled = b.enabled !== false;
          const mode = b.mode === 'SHADOW' ? 'SHADOW' : 'ACTIVE';
          await client.query(
            `INSERT INTO blocklists(name, url, enabled, mode, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (url) DO UPDATE SET name = EXCLUDED.name, enabled = EXCLUDED.enabled, mode = EXCLUDED.mode, updated_at = NOW()`,
            [name, url, enabled, mode]
          );
        }

        for (const r of rules) {
          const domain = String(r.domain).trim();
          const type = String(r.type).trim();
          const category = String((r as any).category ?? 'Manual').trim() || 'Manual';
          if (!domain || (type !== 'BLOCKED' && type !== 'ALLOWED')) continue;
          await client.query(
            `INSERT INTO rules(domain, type, category)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
            [domain, type, category]
          );
        }

        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      return { ok: true, dryRun: false, summary };
    }
  );

  app.get(
    '/api/maintenance/diagnostics',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: app.rateLimit()
    },
    async (request, reply) => {
      await requireAdmin(db, request);

      const counts = async () => {
        const [q, n, r, c, b, ia] = await Promise.all([
          db.pool.query('SELECT COUNT(*)::int AS count FROM query_logs'),
          db.pool.query('SELECT COUNT(*)::int AS count FROM notifications'),
          db.pool.query('SELECT COUNT(*)::int AS count FROM rules'),
          db.pool.query('SELECT COUNT(*)::int AS count FROM clients'),
          db.pool.query('SELECT COUNT(*)::int AS count FROM blocklists'),
          db.pool.query('SELECT COUNT(*)::int AS count FROM ignored_anomalies')
        ]);

        return {
          queryLogs: q.rows?.[0]?.count ?? 0,
          notifications: n.rows?.[0]?.count ?? 0,
          rules: r.rows?.[0]?.count ?? 0,
          clients: c.rows?.[0]?.count ?? 0,
          blocklists: b.rows?.[0]?.count ?? 0,
          ignoredAnomalies: ia.rows?.[0]?.count ?? 0
        };
      };

      const payload = {
        generatedAt: new Date().toISOString(),
        appVersion: readAppVersion(),
        env: config.NODE_ENV,
        dns: {
          enabled: !!config.ENABLE_DNS,
          upstream: config.UPSTREAM_DNS,
          host: config.DNS_HOST,
          port: config.DNS_PORT
        },
        queryLogsRetentionDays: config.QUERY_LOGS_RETENTION_DAYS,
        counts: await counts(),
        resolverControl: {
          supervisorctl: await runSupervisorCtl(['status'])
        }
      };

      const download = String((request.query as any)?.download || '').toLowerCase();
      if (download === '1' || download === 'true') {
        reply.header('content-type', 'application/json; charset=utf-8');
        reply.header('content-disposition', `attachment; filename="sentinel-diagnostics-${new Date().toISOString().slice(0, 10)}.json"`);
      }

      return payload;
    }
  );

  app.post(
    '/api/maintenance/dns/restart-resolver',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: app.rateLimit()
    },
    async (request, reply) => {
      await requireAdmin(db, request);

      const res = await runSupervisorCtl(['restart', 'unbound']);
      if (!res.ok) {
        reply.code(501);
        return { error: 'NOT_SUPPORTED', message: res.error };
      }

      reply.code(202);
      return { ok: true, output: res.stdout };
    }
  );

  app.post(
    '/api/maintenance/dns/reload-resolver',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: app.rateLimit()
    },
    async (request, reply) => {
      await requireAdmin(db, request);

      const res = await runSupervisorCtl(['signal', 'HUP', 'unbound']);
      if (!res.ok) {
        reply.code(501);
        return { error: 'NOT_SUPPORTED', message: res.error };
      }

      reply.code(202);
      return { ok: true, output: res.stdout };
    }
  );

  void config;
}
