import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { getClusterConfig } from './store.js';
import { effectiveRole } from './role.js';

function isMutation(method: string): boolean {
  const m = method.toUpperCase();
  return m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';
}

export function registerFollowerReadOnlyGuard(app: FastifyInstance, config: AppConfig, db: Db): void {
  app.addHook('preHandler', async (request, reply) => {
    if (!isMutation(request.method)) return;

    const url = request.raw.url || '';
    if (!url.startsWith('/api/')) return;
    if (url.startsWith('/api/cluster/')) return;
    if (url.startsWith('/api/health')) return;

    // Allow creating/clearing local sessions so the UI can still be used in read-only mode.
    if (url.startsWith('/api/auth/login')) return;
    if (url.startsWith('/api/auth/logout')) return;

    const cfg = await getClusterConfig(db);
    if (!cfg.enabled) return;

    const role = effectiveRole(config, cfg.role);
    if (role !== 'follower') return;

    reply.code(409);
    // Hooks must explicitly send to short-circuit the request.
    return reply.send({
      error: 'FOLLOWER_READONLY',
      message: 'This node is a follower. Make changes on the leader/VIP.'
    });
  });
}
