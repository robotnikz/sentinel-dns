import crypto from 'node:crypto';
import type { Db } from '../db.js';
import type { AppConfig } from '../config.js';
import { getSecret, setSecret } from '../secretsStore.js';
import { fromBase64UrlJson } from './codec.js';
import { signClusterRequest } from './hmac.js';
import { getClusterConfig, getClusterStatus, setClusterConfig, setLastError, setLastSync } from './store.js';
import type { ClusterExportSnapshot, ClusterJoinCode } from './types.js';
import { effectiveRole } from './role.js';

const CLUSTER_PSK_SECRET_NAME = 'cluster_psk';

export async function ensureClusterPsk(db: Db, config: AppConfig): Promise<string> {
  let psk = await getSecret(db, config, CLUSTER_PSK_SECRET_NAME);
  psk = String(psk || '').trim();
  if (psk) return psk;

  // Lazy-generate on first demand.
  const next = crypto.randomBytes(32).toString('base64url');
  await setSecret(db, config, CLUSTER_PSK_SECRET_NAME, next);
  return next;
}

// Node's global fetch is available in our runtime.
async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    const text = await res.text();
    const body = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const msg = body?.error || body?.message || `HTTP_${res.status}`;
      throw new Error(String(msg));
    }
    return body;
  } finally {
    clearTimeout(t);
  }
}

export async function runFollowerSyncOnce(config: AppConfig, db: Db): Promise<void> {
  const cfg = await getClusterConfig(db);
  if (!cfg.enabled || cfg.role !== 'follower' || !cfg.leaderUrl) return;

  // If keepalived promoted this node to leader, stop syncing.
  if (effectiveRole(config, cfg.role) !== 'follower') return;

  const psk = await getSecret(db, config, CLUSTER_PSK_SECRET_NAME);
  if (!psk) {
    await setLastError(db, 'CLUSTER_PSK_MISSING');
    return;
  }

  const path = '/api/cluster/sync/export';
  const url = `${cfg.leaderUrl.replace(/\/$/, '')}${path}`;
  const body = { want: 'full' };

  const headers = signClusterRequest({ secret: psk, method: 'POST', path, body });

  const snapshot = (await fetchJson(
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body)
    },
    10_000
  )) as ClusterExportSnapshot;

  await applySnapshot(config, db, snapshot);
  await setLastSync(db, new Date().toISOString());
}

export function startFollowerSyncLoop(config: AppConfig, db: Db): { stop: () => void } {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      await runFollowerSyncOnce(config, db);
    } catch (e: any) {
      await setLastError(db, String(e?.message || e || 'SYNC_FAILED'));
    } finally {
      if (!stopped) timer = setTimeout(() => void tick(), 5_000);
    }
  };

  timer = setTimeout(() => void tick(), 2_000);

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    }
  };
}

export async function configureFollowerFromJoinCode(db: Db, config: AppConfig, joinCodeB64Url: string): Promise<void> {
  const join = fromBase64UrlJson<ClusterJoinCode>(joinCodeB64Url);
  const leaderUrl = String(join?.leaderUrl || '').trim();
  const psk = String(join?.psk || '').trim();
  if (!leaderUrl || !/^https?:\/\//i.test(leaderUrl)) throw new Error('INVALID_LEADER_URL');
  if (!psk) throw new Error('INVALID_PSK');

  await setSecret(db, config, CLUSTER_PSK_SECRET_NAME, psk);
  await setClusterConfig(db, { enabled: true, role: 'follower', leaderUrl });
}

export async function makeLeaderJoinCode(db: Db, config: AppConfig, leaderUrl: string): Promise<string> {
  const psk = await ensureClusterPsk(db, config);
  const join: ClusterJoinCode = {
    leaderUrl: leaderUrl.replace(/\/$/, ''),
    psk,
    createdAt: new Date().toISOString()
  };

  return Buffer.from(JSON.stringify(join), 'utf8').toString('base64url');
}

export async function applySnapshot(config: AppConfig, db: Db, snapshot: ClusterExportSnapshot): Promise<void> {
  // Basic sanity.
  if (!snapshot || typeof snapshot !== 'object') throw new Error('BAD_SNAPSHOT');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Settings (excluding secrets and cluster internals). Keep updatedAt for incremental extension later.
    for (const item of snapshot.settings || []) {
      const key = String((item as any).key || '');
      if (!key) continue;
      const value = (item as any).value;
      const updatedAt = String((item as any).updatedAt || new Date().toISOString());

      // Avoid syncing cluster peer config from leader into follower.
      if (key.startsWith('cluster_')) continue;
      if (key.startsWith('secret:')) continue;

      // Avoid carrying active sessions across nodes.
      const normalizedValue =
        key === 'auth_admin' && value && typeof value === 'object'
          ? { ...(value as any), sessions: [] }
          : value;

      await client.query(
        'INSERT INTO settings(key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at',
        [key, normalizedValue, updatedAt]
      );
    }

    // Clients
    for (const c of snapshot.clients || []) {
      const id = String((c as any).id || '');
      if (!id) continue;
      const profile = (c as any).profile;
      const updatedAt = String((c as any).updatedAt || new Date().toISOString());
      await client.query(
        'INSERT INTO clients(id, profile, updated_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = EXCLUDED.updated_at',
        [id, profile, updatedAt]
      );
    }

    // Manual rules (non-blocklist)
    await client.query("DELETE FROM rules WHERE category NOT ILIKE 'blocklist:%'");
    for (const r of snapshot.rules || []) {
      const domain = String((r as any).domain || '').trim();
      const type = String((r as any).type || '').trim();
      const category = String((r as any).category || 'Manual').trim() || 'Manual';
      const createdAt = String((r as any).createdAt || new Date().toISOString());
      if (!domain || (type !== 'ALLOWED' && type !== 'BLOCKED')) continue;
      await client.query(
        'INSERT INTO rules(domain, type, category, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [domain, type, category, createdAt]
      );
    }

    // Blocklists config must keep IDs stable to match client assignedBlocklists.
    await client.query('TRUNCATE blocklists');
    for (const b of snapshot.blocklists || []) {
      const id = Number((b as any).id);
      const name = String((b as any).name || '');
      const url = String((b as any).url || '');
      const enabled = Boolean((b as any).enabled);
      const mode = String((b as any).mode || 'ACTIVE');
      const lastUpdatedAt = (b as any).lastUpdatedAt ? String((b as any).lastUpdatedAt) : null;
      const lastError = (b as any).lastError ? String((b as any).lastError) : null;
      const lastRuleCount = Number((b as any).lastRuleCount ?? 0);
      const createdAt = String((b as any).createdAt || new Date().toISOString());
      const updatedAt = String((b as any).updatedAt || new Date().toISOString());
      if (!Number.isFinite(id) || id <= 0 || !name || !url) continue;
      await client.query(
        `INSERT INTO blocklists(id, name, url, enabled, mode, last_updated_at, last_error, last_rule_count, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, name, url, enabled, mode, lastUpdatedAt, lastError, lastRuleCount, createdAt, updatedAt]
      );
    }
    // Keep sequence sane if this node later adds a new blocklist.
    await client.query(
      "SELECT setval(pg_get_serial_sequence('blocklists','id'), COALESCE((SELECT MAX(id) FROM blocklists), 0))"
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // Secrets are stored encrypted with this node's SECRETS_KEY. Apply after the transaction.
  for (const s of snapshot.secrets || []) {
    const name = String((s as any).name || '').trim();
    const value = String((s as any).value ?? '');
    if (!name) continue;
    await setSecret(db, config, name, value);
  }

  // Clear lastError on success.
  const status = await getClusterStatus(db);
  if (status.lastError) {
    await setLastSync(db, new Date().toISOString());
  }
}
