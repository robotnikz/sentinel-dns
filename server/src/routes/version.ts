import type { FastifyInstance } from 'fastify';

export async function registerVersionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/version', async () => {
    return { version: '0.1.0' };
  });
}
