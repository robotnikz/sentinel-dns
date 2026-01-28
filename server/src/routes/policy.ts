import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { domainPolicyCheck } from '../dns/dnsServer.js';
import 'fastify-rate-limit';

type DomainCheckBody = {
  domain: string;
  clientIp?: string;
};

export async function registerPolicyRoutes(app: FastifyInstance, _config: AppConfig, db: Db): Promise<void> {
  app.post(
    '/api/policy/domaincheck',
    {
      config: {
        rateLimit: { max: 120, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit(),
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['domain'],
          properties: {
            domain: { type: 'string', minLength: 1, maxLength: 253 },
            clientIp: { type: 'string', minLength: 1, maxLength: 128 }
          }
        }
      }
    },
    async (request: FastifyRequest<{ Body: DomainCheckBody }>, reply: FastifyReply) => {
      await requireAdmin(db, request);

      const domain = String(request.body.domain ?? '').trim();
      if (!domain) {
        reply.code(400);
        return { error: 'INVALID_DOMAIN', message: 'domain is required.' };
      }

      const clientIp = typeof request.body.clientIp === 'string' ? request.body.clientIp : undefined;
      const result = await domainPolicyCheck(db, domain, { clientIp });
      return result;
    }
  );
}
