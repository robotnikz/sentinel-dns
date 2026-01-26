import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { hasSecret, setSecret } from '../secretsStore.js';

export async function registerSecretsRoutes(app: FastifyInstance, config: AppConfig, db: Db): Promise<void> {
  app.get('/api/secrets/status', async (request) => {
    await requireAdmin(db, request);
    const [gemini, openai] = await Promise.all([hasSecret(db, 'gemini_api_key'), hasSecret(db, 'openai_api_key')]);
    return { configured: { gemini, openai } };
  });

  app.put(
    '/api/secrets/:name',
    {
      schema: {
        params: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z0-9_]+$' }
          }
        },
        body: {
          type: 'object',
          required: ['value'],
          additionalProperties: false,
          properties: {
            value: { type: 'string', minLength: 1, maxLength: 8192 }
          }
        }
      }
    },
    async (request: FastifyRequest<{ Params: { name: string }; Body: { value: string } }>, reply: FastifyReply) => {
          await requireAdmin(db, request);

      if (!config.SECRETS_KEY) {
        reply.code(500);
        return { error: 'SECRETS_KEY_MISSING', message: 'Server is not configured to store encrypted secrets.' };
      }

      const { name } = request.params;
      const { value } = request.body;

      await setSecret(db, config, name, value);
      return { ok: true };
    }
  );
}
