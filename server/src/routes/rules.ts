import type { FastifyInstance } from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';

export async function registerRulesRoutes(app: FastifyInstance, config: AppConfig, db: Db): Promise<void> {
  app.get(
    '/api/rules',
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
    // The rules table contains both user-created rules and imported rules produced by
    // blocklist refreshes (e.g. category values like "Blocklist:37:...", "Category:...", "App:...").
    // This endpoint is for the UI "Allow/Block" tab and must only return user-created rules.
    const res = await db.pool.query(
      `
      SELECT id, domain, type, category, created_at
      FROM rules
      WHERE category NOT ILIKE 'blocklist:%'
        AND category NOT ILIKE 'category:%'
        AND category NOT ILIKE 'app:%'
      ORDER BY id DESC
      LIMIT 500
      `
    );
    return { items: res.rows };
    }
  );

  app.post(
    '/api/rules',
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
          required: ['domain', 'type'],
          properties: {
            domain: { type: 'string', minLength: 1, maxLength: 253 },
            type: { type: 'string', enum: ['BLOCKED', 'ALLOWED'] },
            category: { type: 'string', minLength: 1, maxLength: 100 }
          }
        }
      }
    },
    async (
      request: FastifyRequest<{ Body: { domain: string; type: 'BLOCKED' | 'ALLOWED'; category?: string } }>,
      reply: FastifyReply
    ) => {
      await requireAdmin(db, request);

      const { domain, type, category } = request.body;

      try {
        const res = await db.pool.query(
          'INSERT INTO rules(domain, type, category) VALUES ($1, $2, $3) RETURNING id, domain, type, category, created_at',
          [domain, type, category ?? 'Manual']
        );
        reply.code(201);
        return res.rows[0];
      } catch (err: any) {
        if (String(err?.code) === '23505') {
          reply.code(409);
          return { error: 'RULE_EXISTS', message: 'Rule already exists for this domain' };
        }
        throw err;
      }
    }
  );

  app.delete(
    '/api/rules/:id',
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

    const { id } = request.params;
    const res = await db.pool.query('DELETE FROM rules WHERE id = $1', [id]);

    if (res.rowCount === 0) {
      reply.code(404);
      return { error: 'NOT_FOUND' };
    }

    reply.code(204);
    return null;
    }
  );
}
