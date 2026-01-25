import type { FastifyInstance } from 'fastify';

export async function registerClusterRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/cluster/status', async () => {
    return {
      mode: 'standalone',
      peers: [],
      lastSync: null
    };
  });
}
