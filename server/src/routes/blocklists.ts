import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { notifyEvent } from '../notifications/notify.js';
import { refreshBlocklist } from '../blocklists/refresh.js';

type BlocklistRow = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  mode: 'ACTIVE' | 'SHADOW';
  last_updated_at: string | null;
  last_error: string | null;
  last_rule_count: number;
  created_at: string;
  updated_at: string;
};

function normalizeMode(input: any): 'ACTIVE' | 'SHADOW' {
  return input === 'SHADOW' ? 'SHADOW' : 'ACTIVE';
}

function resolveEnabledAndMode(body: { enabled?: boolean; mode?: 'ACTIVE' | 'SHADOW' | 'DISABLED' }): {
  enabled: boolean;
  mode: 'ACTIVE' | 'SHADOW';
} {
  if (body.mode === 'DISABLED') return { enabled: false, mode: 'ACTIVE' };
  const enabled = body.enabled !== false;
  if (!enabled) return { enabled: false, mode: 'ACTIVE' };
  return { enabled: true, mode: normalizeMode(body.mode) };
}


export async function registerBlocklistsRoutes(app: FastifyInstance, config: AppConfig, db: Db): Promise<void> {
  app.get(
    '/api/blocklists',
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute'
        }
      }
    },
    async (request) => {
      await requireAdmin(db, request);
      const res = await db.pool.query(
        'SELECT id, name, url, enabled, mode, last_updated_at, last_error, last_rule_count, created_at, updated_at FROM blocklists ORDER BY id DESC LIMIT 500'
      );
      return { items: res.rows.map((r) => ({ ...r, id: String(r.id) })) as BlocklistRow[] };
    }
  );

  app.post(
    '/api/blocklists',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute'
        }
      },
      schema: {
        body: {
          type: 'object',
          required: ['name', 'url'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
            url: { type: 'string', minLength: 8, maxLength: 2048 },
            enabled: { type: 'boolean' },
            mode: { type: 'string', enum: ['ACTIVE', 'SHADOW', 'DISABLED'] }
          }
        }
      }
    },
    async (
      request: FastifyRequest<{ Body: { name: string; url: string; enabled?: boolean; mode?: 'ACTIVE' | 'SHADOW' | 'DISABLED' } }>,
      reply: FastifyReply
    ) => {
      await requireAdmin(db, request);
      const name = request.body.name.trim();
      const url = request.body.url.trim();
      const resolved = resolveEnabledAndMode({ enabled: request.body.enabled, mode: request.body.mode });

      try {
        const res = await db.pool.query(
          `INSERT INTO blocklists(name, url, enabled, mode, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           RETURNING id, name, url, enabled, mode, last_updated_at, last_error, last_rule_count, created_at, updated_at`,
          [name, url, resolved.enabled, resolved.mode]
        );
        reply.code(201);
        return { ...res.rows[0], id: String(res.rows[0].id) };
      } catch (err: any) {
        if (String(err?.code) === '23505') {
          reply.code(409);
          return { error: 'BLOCKLIST_EXISTS', message: 'A blocklist with this URL already exists.' };
        }
        throw err;
      }
    }
  );

  app.put(
    '/api/blocklists/:id',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute'
        }
      },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
            url: { type: 'string', minLength: 8, maxLength: 2048 },
            enabled: { type: 'boolean' },
            mode: { type: 'string', enum: ['ACTIVE', 'SHADOW', 'DISABLED'] }
          }
        }
      }
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { name?: string; url?: string; enabled?: boolean; mode?: 'ACTIVE' | 'SHADOW' | 'DISABLED' };
      }>,
      reply: FastifyReply
    ) => {
      await requireAdmin(db, request);

      const id = Number(request.params.id);
      if (!Number.isFinite(id)) {
        reply.code(400);
        return { error: 'INVALID_ID' };
      }

      const current = await db.pool.query('SELECT id, name, url, enabled, mode FROM blocklists WHERE id = $1', [id]);
      if (current.rowCount === 0) {
        reply.code(404);
        return { error: 'NOT_FOUND' };
      }

      const resolved = resolveEnabledAndMode({
        enabled: request.body.enabled != null ? !!request.body.enabled : current.rows[0].enabled,
        mode: request.body.mode != null ? request.body.mode : normalizeMode(current.rows[0].mode)
      });

      const next = {
        name: request.body.name != null ? request.body.name.trim() : current.rows[0].name,
        url: request.body.url != null ? request.body.url.trim() : current.rows[0].url,
        enabled: resolved.enabled,
        mode: resolved.mode
      };

      const res = await db.pool.query(
        `UPDATE blocklists SET name = $2, url = $3, enabled = $4, mode = $5, updated_at = NOW() WHERE id = $1
         RETURNING id, name, url, enabled, mode, last_updated_at, last_error, last_rule_count, created_at, updated_at`,
        [id, next.name, next.url, next.enabled, next.mode]
      );

      return { ...res.rows[0], id: String(res.rows[0].id) };
    }
  );

  app.delete(
    '/api/blocklists/:id',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute'
        }
      }
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      await requireAdmin(db, request);
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) {
        reply.code(400);
        return { error: 'INVALID_ID' };
      }

      const res = await db.pool.query('DELETE FROM blocklists WHERE id = $1', [id]);
      if (res.rowCount === 0) {
        reply.code(404);
        return { error: 'NOT_FOUND' };
      }

      reply.code(204);
      return null;
    }
  );

  app.post(
    '/api/blocklists/:id/refresh',
    {
      config: {
        rateLimit: {
          // Refresh can be expensive and triggers network IO.
          max: 10,
          timeWindow: '1 minute'
        }
      }
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      await requireAdmin(db, request);
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) {
        reply.code(400);
        return { error: 'INVALID_ID' };
      }

      const row = await db.pool.query('SELECT id, name, url, enabled FROM blocklists WHERE id = $1', [id]);
      if (row.rowCount === 0) {
        reply.code(404);
        return { error: 'NOT_FOUND' };
      }

      const name = String(row.rows[0].name);
      const url = String(row.rows[0].url);

      try {
        const { fetched } = await refreshBlocklist(db, { id, name, url });

        reply.code(202);
        return { ok: true, fetched };
      } catch (e: any) {
        const msg = String(e?.message || e);
        await db.pool.query(
          'UPDATE blocklists SET last_error = $2, updated_at = NOW() WHERE id = $1',
          [id, msg]
        );

        try {
          await notifyEvent(db, config, 'blocklistRefreshFailed', {
            title: 'Blocklist refresh failed',
            message: `${name}: ${msg}`.slice(0, 2000),
            severity: 'error',
            meta: { id, name, url }
          });
        } catch {
          // ignore
        }

        reply.code(502);
        return { error: 'REFRESH_FAILED', message: msg };
      }
    }
  );
}
