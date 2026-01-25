import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';

export type DnsRewrite = {
  id: string;
  domain: string;
  target: string;
};

function normalizeDomain(input: unknown): string {
  const d = String(input ?? '').trim().toLowerCase();
  return d.endsWith('.') ? d.slice(0, -1) : d;
}

function validateRewrite(r: DnsRewrite): { ok: true } | { ok: false; error: string } {
  if (!r.id || r.id.length > 128) return { ok: false, error: 'INVALID_ID' };
  const domain = normalizeDomain(r.domain);
  if (!domain || domain.length > 253 || !domain.includes('.')) return { ok: false, error: 'INVALID_DOMAIN' };
  if (!/^[a-z0-9.-]+$/.test(domain)) return { ok: false, error: 'INVALID_DOMAIN' };
  const target = String(r.target ?? '').trim();
  if (!target || target.length > 253) return { ok: false, error: 'INVALID_TARGET' };
  return { ok: true };
}

function readRewrites(value: unknown): DnsRewrite[] {
  const arr = Array.isArray((value as any)?.items) ? (value as any).items : Array.isArray(value) ? (value as any) : [];
  const out: DnsRewrite[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const id = String((raw as any).id ?? '').trim();
    const domain = normalizeDomain((raw as any).domain);
    const target = String((raw as any).target ?? '').trim();
    if (!id || !domain || !target) continue;
    out.push({ id, domain, target });
  }
  return out;
}

async function saveRewrites(db: Db, rewrites: DnsRewrite[]): Promise<void> {
  await db.pool.query(
    'INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
    ['dns_rewrites', { items: rewrites }]
  );
}

export async function registerRewritesRoutes(app: FastifyInstance, config: AppConfig, db: Db): Promise<void> {
  app.get('/api/dns/rewrites', async (request) => {
    await requireAdmin(db, request);
    const res = await db.pool.query('SELECT value FROM settings WHERE key = $1', ['dns_rewrites']);
    return { items: readRewrites(res.rows?.[0]?.value) };
  });

  app.post(
    '/api/dns/rewrites',
    {
      schema: {
        body: {
          type: 'object',
          required: ['domain', 'target'],
          additionalProperties: false,
          properties: {
            domain: { type: 'string', minLength: 1, maxLength: 253 },
            target: { type: 'string', minLength: 1, maxLength: 253 }
          }
        }
      }
    },
    async (request: FastifyRequest<{ Body: { domain: string; target: string } }>, reply: FastifyReply) => {
      await requireAdmin(db, request);

      const res = await db.pool.query('SELECT value FROM settings WHERE key = $1', ['dns_rewrites']);
      const rewrites = readRewrites(res.rows?.[0]?.value);

      const id = crypto.randomUUID();
      const next: DnsRewrite = { id, domain: request.body.domain, target: request.body.target };
      const valid = validateRewrite(next);
      if (!valid.ok) {
        reply.code(400);
        return { error: valid.error };
      }

      // De-dupe by domain (replace existing)
      const domainNorm = normalizeDomain(next.domain);
      const filtered = rewrites.filter((r) => normalizeDomain(r.domain) !== domainNorm);
      filtered.unshift({ ...next, domain: domainNorm });

      await saveRewrites(db, filtered);
      reply.code(201);
      return { item: next };
    }
  );

  app.put(
    '/api/dns/rewrites/:id',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            domain: { type: 'string', minLength: 1, maxLength: 253 },
            target: { type: 'string', minLength: 1, maxLength: 253 }
          }
        }
      }
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { domain?: string; target?: string } }>,
      reply: FastifyReply
    ) => {
      await requireAdmin(db, request);

      const res = await db.pool.query('SELECT value FROM settings WHERE key = $1', ['dns_rewrites']);
      const rewrites = readRewrites(res.rows?.[0]?.value);
      const idx = rewrites.findIndex((r) => r.id === request.params.id);
      if (idx < 0) {
        reply.code(404);
        return { error: 'NOT_FOUND' };
      }

      const updated: DnsRewrite = {
        id: request.params.id,
        domain: request.body.domain ?? rewrites[idx].domain,
        target: request.body.target ?? rewrites[idx].target
      };

      const valid = validateRewrite(updated);
      if (!valid.ok) {
        reply.code(400);
        return { error: valid.error };
      }

      rewrites[idx] = { ...updated, domain: normalizeDomain(updated.domain) };
      await saveRewrites(db, rewrites);
      return { item: rewrites[idx] };
    }
  );

  app.delete(
    '/api/dns/rewrites/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      await requireAdmin(db, request);

      const res = await db.pool.query('SELECT value FROM settings WHERE key = $1', ['dns_rewrites']);
      const rewrites = readRewrites(res.rows?.[0]?.value);
      const next = rewrites.filter((r) => r.id !== request.params.id);

      if (next.length === rewrites.length) {
        reply.code(404);
        return { error: 'NOT_FOUND' };
      }

      await saveRewrites(db, next);
      reply.code(204);
      return null;
    }
  );

  void config;
}
