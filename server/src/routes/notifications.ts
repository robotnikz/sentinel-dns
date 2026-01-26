import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';
import 'fastify-rate-limit';

async function insertNotification(db: Db, entry: any): Promise<void> {
  try {
    await db.pool.query('INSERT INTO notifications(entry) VALUES ($1)', [entry]);
  } catch {
    // ignore
  }
}

function normalizeDiscordWebhookUrl(raw: unknown): string {
  const url = String(raw ?? '').trim();
  if (!url) return '';
  // Keep it tight: this endpoint is admin-only, but we still avoid accidental SSRF.
  if (!url.startsWith('https://discord.com/api/webhooks/')) return '';
  return url;
}

export async function registerNotificationRoutes(app: FastifyInstance, config: AppConfig, db: Db): Promise<void> {
  app.get(
    '/api/notifications/feed',
    {
      config: {
        rateLimit: { max: 120, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit()
    },
    async (request) => {
      await requireAdmin(db, request);
      const limitRaw = (request.query as any)?.limit;
      const limit = Math.min(200, Math.max(1, Number.isFinite(Number(limitRaw)) ? Math.floor(Number(limitRaw)) : 50));
      const res = await db.pool.query(
        'SELECT id, ts, read, entry FROM notifications ORDER BY ts DESC LIMIT $1',
        [limit]
      );
      return { items: res.rows };
    }
  );

  app.get(
    '/api/notifications/feed/unread-count',
    {
      config: {
        rateLimit: { max: 120, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit()
    },
    async (request) => {
      await requireAdmin(db, request);
      const res = await db.pool.query('SELECT COUNT(*)::int AS count FROM notifications WHERE read = FALSE');
      return { count: res.rows?.[0]?.count ?? 0 };
    }
  );

  app.post(
    '/api/notifications/feed/mark-read',
    {
      config: {
        rateLimit: { max: 60, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit(),
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            all: { type: 'boolean' },
            ids: { type: 'array', items: { type: 'number' } }
          }
        }
      }
    },
    async (request) => {
      await requireAdmin(db, request);
      const body = (request.body as any) ?? {};
      if (body.all === true) {
        await db.pool.query('UPDATE notifications SET read = TRUE WHERE read = FALSE');
        return { ok: true };
      }
      const ids = Array.isArray(body.ids) ? body.ids.map((n: any) => Number(n)).filter((n: any) => Number.isFinite(n)) : [];
      if (ids.length === 0) return { ok: true };
      await db.pool.query('UPDATE notifications SET read = TRUE WHERE id = ANY($1::bigint[])', [ids]);
      return { ok: true };
    }
  );

  app.post(
    '/api/notifications/discord/test',
    {
      config: {
        rateLimit: { max: 10, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit(),
      schema: {
        body: {
          type: 'object',
          additionalProperties: true
        }
      }
    },
    async (request, reply) => {
      await requireAdmin(db, request);

      const res = await db.pool.query('SELECT value FROM settings WHERE key = $1', ['discord_webhook']);
      const value = res.rows?.[0]?.value;

      const candidate =
        typeof value === 'string' ? value : typeof (value as any)?.url === 'string' ? (value as any).url : '';
      const url = normalizeDiscordWebhookUrl(candidate);

      if (!url) {
        reply.code(400);
        return {
          error: 'NO_WEBHOOK',
          message: 'No valid Discord webhook configured on the server.'
        };
      }

      const payload = {
        username: 'Sentinel DNS',
        embeds: [
          {
            title: 'Sentinel Test Notification',
            description: 'This is a test alert from the Sentinel-DNS backend.',
            color: 0x3b82f6,
            timestamp: new Date().toISOString()
          }
        ]
      };

      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 5000);
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ac.signal
        });

        if (!r.ok) {
          reply.code(502);
          return { error: 'WEBHOOK_FAILED', message: `Webhook returned ${r.status}` };
        }

        await insertNotification(db, {
          kind: 'discord',
          title: 'Sentinel Test Notification',
          message: 'This is a test alert from the Sentinel-DNS backend.',
          severity: 'info',
          sentAt: new Date().toISOString()
        });

        return { ok: true };
      } catch (e) {
        reply.code(502);
        return { error: 'WEBHOOK_FAILED', message: 'Webhook request failed.' };
      } finally {
        clearTimeout(t);
      }
    }
  );

  void config;
}
