import type { FastifyInstance } from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';
import ipaddr from 'ipaddr.js';
import 'fastify-rate-limit';

type ClientProfile = Record<string, unknown> & { id: string };

export async function registerClientsRoutes(app: FastifyInstance, config: AppConfig, db: Db): Promise<void> {
  app.get(
    '/api/clients',
    {
        config: {
          rateLimit: { max: 120, timeWindow: '1 minute' }
        },
        preHandler: app.rateLimit()
    },
    async (request) => {
      await requireAdmin(db, request);
      const res = await db.pool.query('SELECT profile FROM clients ORDER BY updated_at DESC LIMIT 2000');
      return { items: res.rows.map((r) => r.profile) };
    }
  );

  app.put(
    '/api/clients/:id',
    {
        config: {
          rateLimit: { max: 60, timeWindow: '1 minute' }
        },
        preHandler: app.rateLimit(),
      schema: {
        body: {
          type: 'object',
          required: ['id', 'name', 'type'],
          additionalProperties: true,
          properties: {
            id: { type: 'string', minLength: 1, maxLength: 128 },
            name: { type: 'string', minLength: 1, maxLength: 200 },
            type: {
              type: 'string',
              enum: ['laptop', 'smartphone', 'tv', 'game', 'iot', 'tablet', 'subnet']
            }
          }
        }
      }
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: ClientProfile }>,
      reply: FastifyReply
    ) => {
      await requireAdmin(db, request);

      const { id } = request.params;
      const profile = request.body;

      if (profile.id !== id) {
        reply.code(400);
        return { error: 'ID_MISMATCH', message: 'Body id must match path id.' };
      }

      // Hard requirement: subnet entries must define a valid CIDR.
      if (profile.type === 'subnet') {
        const cidr = typeof (profile as any).cidr === 'string' ? String((profile as any).cidr).trim() : '';
        if (!cidr) {
          reply.code(400);
          return { error: 'INVALID_CIDR', message: 'Subnet profiles must include a CIDR.' };
        }
        try {
          ipaddr.parseCIDR(cidr);
        } catch {
          reply.code(400);
          return { error: 'INVALID_CIDR', message: 'CIDR is not valid.' };
        }
      }

      const res = await db.pool.query(
        `INSERT INTO clients(id, profile, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = NOW()
         RETURNING profile`,
        [id, profile]
      );

      return res.rows[0].profile;
    }
  );

  app.delete(
    '/api/clients/:id',
    {
        config: {
          rateLimit: { max: 60, timeWindow: '1 minute' }
        },
        preHandler: app.rateLimit()
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      await requireAdmin(db, request);

      const { id } = request.params;
      const res = await db.pool.query('DELETE FROM clients WHERE id = $1', [id]);

      if (res.rowCount === 0) {
        reply.code(404);
        return { error: 'NOT_FOUND' };
      }

      reply.code(204);
      return null;
    }
  );
}
