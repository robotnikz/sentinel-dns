import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { getClusterConfig } from './store.js';

function isMutation(method: string): boolean {
  const m = method.toUpperCase();
  return m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';
}

function isAllowedMutationOnConfiguredFollower(url: string): boolean {
  // HA setup must remain writable on every node.
  if (url.startsWith('/api/cluster/')) return true;
  if (url.startsWith('/api/health')) return true;

  // Allow local session + account maintenance so the UI remains usable.
  if (url.startsWith('/api/auth/login')) return true;
  if (url.startsWith('/api/auth/logout')) return true;
  if (url.startsWith('/api/auth/change-password')) return true;

  // Operational writes that do not change configuration:
  // - query log maintenance / ingest
  // - ignored anomalies list
  // - notification read markers
  if (url.startsWith('/api/query-logs/')) return true;
  if (url.startsWith('/api/suspicious/ignored')) return true;
  if (url.startsWith('/api/notifications/feed/mark-read')) return true;

  // Maintenance endpoints that only affect operational data.
  if (url.startsWith('/api/maintenance/query-logs/')) return true;
  if (url.startsWith('/api/maintenance/notifications/clear')) return true;
  if (url.startsWith('/api/maintenance/ignored-anomalies/clear')) return true;

  return false;
}

export function registerFollowerReadOnlyGuard(app: FastifyInstance, config: AppConfig, db: Db): void {
  app.addHook('preHandler', async (request, reply) => {
    if (!isMutation(request.method)) return;

    const url = request.raw.url || '';
    if (!url.startsWith('/api/')) return;

    if (isAllowedMutationOnConfiguredFollower(url)) return;

    const cfg = await getClusterConfig(db);
    if (!cfg.enabled) return;

    // Backup-only semantics: a configured follower is always read-only,
    // even if keepalived temporarily overrides the *effective* role.
    if (cfg.role !== 'follower') return;

    reply.code(409);
    // Hooks must explicitly send to short-circuit the request.
    return reply.send({
      error: 'FOLLOWER_READONLY',
      message: 'This node is a follower. Make changes on the leader/VIP.'
    });
  });
}
