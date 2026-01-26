import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';

export async function registerClusterRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.get('/api/cluster/status', async (request) => {
    await requireAdmin(db, request);
    return {
      mode: 'standalone',
      peers: [],
      lastSync: null
    };
  });
}
