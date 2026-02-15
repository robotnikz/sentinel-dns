import crypto from 'node:crypto';
import type { Db } from '../db.js';
import type { AppConfig } from '../config.js';
import { getSecret, setSecret } from '../secretsStore.js';
import { fromBase64UrlJson } from './codec.js';
import { signClusterRequest } from './hmac.js';
import { getClusterConfig, getClusterStatus, setClusterConfig, setLastError, setLastSync, setLastSyncDetails } from './store.js';
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

  const started = Date.now();

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

  const finished = Date.now();
  const snapshotJson = JSON.stringify(snapshot);
  await setLastSyncDetails(db, {
    tsIso: new Date().toISOString(),
    durationMs: Math.max(0, finished - started),
    snapshotBytes: Buffer.byteLength(snapshotJson, 'utf8'),
    snapshotCounts: {
      settings: Array.isArray((snapshot as any).settings) ? (snapshot as any).settings.length : 0,
      clients: Array.isArray((snapshot as any).clients) ? (snapshot as any).clients.length : 0,
      rules: Array.isArray((snapshot as any).rules) ? (snapshot as any).rules.length : 0,
      blocklists: Array.isArray((snapshot as any).blocklists) ? (snapshot as any).blocklists.length : 0,
      secrets: Array.isArray((snapshot as any).secrets) ? (snapshot as any).secrets.length : 0
    }
  });
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
  const createdAt = String(join?.createdAt || '').trim();
  if (!leaderUrl || !/^https?:\/\//i.test(leaderUrl)) throw new Error('INVALID_LEADER_URL');
  if (!psk) throw new Error('INVALID_PSK');

  // Join-code TTL applies only to initial follower configuration.
  // It does NOT affect ongoing sync after a follower is configured.
  const ttlMsRaw = Number((config as any).CLUSTER_JOIN_CODE_TTL_MS ?? process.env.CLUSTER_JOIN_CODE_TTL_MS ?? 60 * 60 * 1000);
  const ttlMs = Number.isFinite(ttlMsRaw) && ttlMsRaw > 0 ? ttlMsRaw : 60 * 60 * 1000;
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) throw new Error('INVALID_JOIN_CODE');
  if (Date.now() - createdMs > ttlMs) throw new Error('JOIN_CODE_EXPIRED');

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

    // Preserve local admin sessions on followers.
    // We want the admin password/hash to follow the leader, but sessions are node-local.
    // If we overwrite auth_admin blindly, the UI will intermittently get 401s because sync runs every few seconds.
    let existingAuthValue: any = null;
    try {
      const authRes = await client.query('SELECT value FROM settings WHERE key = $1', ['auth_admin']);
      existingAuthValue = authRes.rows?.[0]?.value ?? null;
    } catch {
      existingAuthValue = null;
    }
    const existingAuthSessions: any[] = Array.isArray(existingAuthValue?.sessions) ? existingAuthValue.sessions : [];
    const existingAuthPassword = existingAuthValue?.adminUser?.password ?? existingAuthValue?.adminPassword ?? null;

    // Settings (excluding secrets and cluster internals). Keep updatedAt for incremental extension later.
    for (const item of snapshot.settings || []) {
      const key = String((item as any).key || '');
      if (!key) continue;
      const value = (item as any).value;
      const updatedAt = String((item as any).updatedAt || new Date().toISOString());

      // Avoid syncing cluster peer config from leader into follower.
      if (key.startsWith('cluster_')) continue;
      if (key.startsWith('secret:')) continue;

      // Avoid carrying leader sessions across nodes, but preserve *local* follower sessions.
      let normalizedValue = value;
      if (key === 'auth_admin' && value && typeof value === 'object') {
        const incoming: any = value;
        const incomingPassword = incoming?.adminUser?.password ?? incoming?.adminPassword ?? null;
        const samePassword = JSON.stringify(incomingPassword) === JSON.stringify(existingAuthPassword);
        const sessionsToKeep = samePassword ? existingAuthSessions : [];

        if (incoming?.adminUser) {
          normalizedValue = { ...incoming, sessions: sessionsToKeep };
        } else if (incoming?.adminPassword) {
          // Backward-compat: normalize to adminUser shape.
          normalizedValue = { adminUser: { username: 'admin', password: incoming.adminPassword }, sessions: sessionsToKeep };
        } else {
          normalizedValue = { ...incoming, sessions: sessionsToKeep };
        }
      }

      await client.query(
        'INSERT INTO settings(key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at',
        [key, normalizedValue, updatedAt]
      );
    }

    // Clients
    {
      const incomingClients = Array.isArray(snapshot.clients) ? snapshot.clients : [];
      const incomingIds = incomingClients
        .map((c: any) => String(c?.id || '').trim())
        .filter(Boolean);

      // Snapshot sync should converge follower state to leader state, including deletions.
      // If the leader deletes a client/subnet profile, it must disappear from the follower.
      if (incomingIds.length === 0) {
        await client.query('DELETE FROM clients');
      } else {
        await client.query('DELETE FROM clients WHERE NOT (id = ANY($1::text[]))', [incomingIds]);
      }

      for (const c of incomingClients) {
        const id = String((c as any).id || '');
        if (!id) continue;
        const profile = (c as any).profile;
        const updatedAt = String((c as any).updatedAt || new Date().toISOString());
        await client.query(
          'INSERT INTO clients(id, profile, updated_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = EXCLUDED.updated_at',
          [id, profile, updatedAt]
        );
      }
    }

    // Manual rules (non-blocklist) – batch insert via unnest.
    await client.query("DELETE FROM rules WHERE category NOT ILIKE 'blocklist:%'");

    {
      const domains: string[] = [];
      const types: string[] = [];
      const categories: string[] = [];
      const createdAts: string[] = [];

      for (const r of snapshot.rules || []) {
        const domain = String((r as any).domain || '').trim();
        const type = String((r as any).type || '').trim();
        if (!domain || (type !== 'ALLOWED' && type !== 'BLOCKED')) continue;
        domains.push(domain);
        types.push(type);
        categories.push(String((r as any).category || 'Manual').trim() || 'Manual');
        createdAts.push(String((r as any).createdAt || new Date().toISOString()));
      }

      if (domains.length) {
        await client.query(
          `INSERT INTO rules(domain, type, category, created_at)
           SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[])
           ON CONFLICT DO NOTHING`,
          [domains, types, categories, createdAts]
        );
      }
    }

    // Blocklists config must keep IDs stable to match client assignedBlocklists.
    await client.query('TRUNCATE blocklists');

    {
      const ids: number[] = [];
      const names: string[] = [];
      const urls: string[] = [];
      const enableds: boolean[] = [];
      const modes: string[] = [];
      const lastUpdatedAts: (string | null)[] = [];
      const lastErrors: (string | null)[] = [];
      const lastRuleCounts: number[] = [];
      const createdAts: string[] = [];
      const updatedAts: string[] = [];

      for (const b of snapshot.blocklists || []) {
        const id = Number((b as any).id);
        const name = String((b as any).name || '');
        const url = String((b as any).url || '');
        if (!Number.isFinite(id) || id <= 0 || !name || !url) continue;
        ids.push(id);
        names.push(name);
        urls.push(url);
        enableds.push(Boolean((b as any).enabled));
        modes.push(String((b as any).mode || 'ACTIVE'));
        lastUpdatedAts.push((b as any).lastUpdatedAt ? String((b as any).lastUpdatedAt) : null);
        lastErrors.push((b as any).lastError ? String((b as any).lastError) : null);
        lastRuleCounts.push(Number((b as any).lastRuleCount ?? 0));
        createdAts.push(String((b as any).createdAt || new Date().toISOString()));
        updatedAts.push(String((b as any).updatedAt || new Date().toISOString()));
      }

      if (ids.length) {
        await client.query(
          `INSERT INTO blocklists(id, name, url, enabled, mode, last_updated_at, last_error, last_rule_count, created_at, updated_at)
           SELECT * FROM unnest(
             $1::int[], $2::text[], $3::text[], $4::boolean[], $5::text[],
             $6::timestamptz[], $7::text[], $8::int[], $9::timestamptz[], $10::timestamptz[]
           )`,
          [ids, names, urls, enableds, modes, lastUpdatedAts, lastErrors, lastRuleCounts, createdAts, updatedAts]
        );
      }
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
