import crypto from 'node:crypto';
import type { Db } from '../db.js';
import type { ClusterConfig, ClusterStatus, ClusterRole } from './types.js';

const KEY_NODE_ID = 'cluster_node_id';
const KEY_CLUSTER_CONFIG = 'cluster_config';
const KEY_CLUSTER_META = 'cluster_meta';

type ClusterMeta = {
  lastSync?: string;
  lastError?: string;
};

function randomId(): string {
  return crypto.randomBytes(16).toString('base64url');
}

export async function getOrCreateNodeId(db: Db): Promise<string> {
  const res = await db.pool.query('SELECT value FROM settings WHERE key = $1', [KEY_NODE_ID]);
  const v = res.rows?.[0]?.value;
  if (typeof v === 'string' && v.trim()) return v.trim();

  const nodeId = randomId();
  await db.pool.query(
    'INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
    [KEY_NODE_ID, nodeId]
  );
  return nodeId;
}

export async function getClusterConfig(db: Db): Promise<ClusterConfig> {
  const res = await db.pool.query('SELECT value FROM settings WHERE key = $1', [KEY_CLUSTER_CONFIG]);
  const value = res.rows?.[0]?.value;
  if (!value || typeof value !== 'object') return { enabled: false, role: 'standalone' };

  const v: any = value;
  const role: ClusterRole = v.role === 'leader' || v.role === 'follower' ? v.role : 'standalone';
  return {
    enabled: v.enabled === true,
    role,
    leaderUrl: typeof v.leaderUrl === 'string' && v.leaderUrl.trim() ? v.leaderUrl.trim() : undefined
  };
}

export async function setClusterConfig(db: Db, cfg: ClusterConfig): Promise<void> {
  await db.pool.query(
    'INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
    [KEY_CLUSTER_CONFIG, cfg]
  );
}

export async function getClusterMeta(db: Db): Promise<ClusterMeta> {
  const res = await db.pool.query('SELECT value FROM settings WHERE key = $1', [KEY_CLUSTER_META]);
  const value = res.rows?.[0]?.value;
  if (!value || typeof value !== 'object') return {};
  return value as ClusterMeta;
}

export async function setClusterMeta(db: Db, meta: ClusterMeta): Promise<void> {
  await db.pool.query(
    'INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
    [KEY_CLUSTER_META, meta]
  );
}

export async function setLastSync(db: Db, tsIso: string): Promise<void> {
  const prev = await getClusterMeta(db);
  await setClusterMeta(db, { ...prev, lastSync: tsIso, lastError: undefined });
}

export async function setLastError(db: Db, message: string): Promise<void> {
  const prev = await getClusterMeta(db);
  await setClusterMeta(db, { ...prev, lastError: message });
}

export async function getClusterStatus(db: Db): Promise<ClusterStatus> {
  const [nodeId, cfg, meta] = await Promise.all([getOrCreateNodeId(db), getClusterConfig(db), getClusterMeta(db)]);
  return {
    nodeId,
    config: cfg,
    lastSync: meta.lastSync,
    lastError: meta.lastError
  };
}

export function isClusterInternalKey(key: string): boolean {
  return key === KEY_NODE_ID || key === KEY_CLUSTER_CONFIG || key === KEY_CLUSTER_META;
}
