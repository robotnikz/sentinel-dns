import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';

export async function registerHealthRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  app.get('/api/health', async () => {
    return {
      ok: true,
      env: config.NODE_ENV,
      time: new Date().toISOString()
    };
  });
}
