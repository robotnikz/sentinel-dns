import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';
import type { AppConfig } from '../config.js';
import { getSecret, hasSecret, setSecret } from '../secretsStore.js';
import { verifyClusterRequest } from '../cluster/hmac.js';
import { getClusterStatus, setClusterConfig } from '../cluster/store.js';
import { configureFollowerFromJoinCode, ensureClusterPsk, makeLeaderJoinCode } from '../cluster/sync.js';
import type { ClusterExportSnapshot } from '../cluster/types.js';
import { effectiveRole, readRoleOverride } from '../cluster/role.js';
import 'fastify-rate-limit';

function unauthorized(): Error {
  const err = new Error('Unauthorized');
  // @ts-expect-error Fastify maps this
  err.statusCode = 401;
  return err;
}

// Best-effort replay protection for cluster-internal requests.
// This is intentionally in-memory (per leader instance) and TTL-bounded.
const SEEN_NONCES = new Map<string, number>();
const NONCE_TTL_MS = 2 * 60_000;
const MAX_NONCES = 5_000;

function rememberNonce(nonce: string): boolean {
  const now = Date.now();
  const existing = SEEN_NONCES.get(nonce);
  if (existing !== undefined && now - existing < NONCE_TTL_MS) return false;

  SEEN_NONCES.set(nonce, now);

  // Opportunistic cleanup.
  if (SEEN_NONCES.size > MAX_NONCES) {
    for (const [k, ts] of SEEN_NONCES) {
      if (now - ts >= NONCE_TTL_MS) SEEN_NONCES.delete(k);
      if (SEEN_NONCES.size <= MAX_NONCES) break;
    }
  }

  return true;
}

async function requireClusterAuth(db: Db, config: AppConfig, request: any): Promise<void> {
  const secret = await getSecret(db, config, 'cluster_psk');
  if (!secret) throw unauthorized();

  const v = verifyClusterRequest({
    secret,
    method: request.method,
    path: request.routerPath || request.raw?.url?.split('?')[0] || '',
    body: request.body,
    tsHeader: request.headers['x-sentinel-ts'],
    nonceHeader: request.headers['x-sentinel-nonce'],
    sigHeader: request.headers['x-sentinel-sig']
  });

  if (!v.ok) throw unauthorized();

  const nonce = String(request.headers['x-sentinel-nonce'] || '').trim();
  if (!nonce) throw unauthorized();
  if (!rememberNonce(nonce)) throw unauthorized();
}

export async function registerClusterRoutes(app: FastifyInstance, config: AppConfig, db: Db): Promise<void> {
  // Admin status (UI)
  app.get('/api/cluster/status', async (request) => {
    await requireAdmin(db, request);
    const status = await getClusterStatus(db);
    const override = readRoleOverride(config);
    return {
      ...status,
      effectiveRole: effectiveRole(config, status.config.role),
      roleOverride: override ?? null
    };
  });

  // Best-effort host network info for the HA wizard (written by keepalived sidecar into /data).
  app.get('/api/cluster/netinfo', async (request) => {
    await requireAdmin(db, request);

    const netinfoPath = path.join(config.DATA_DIR || '/data', 'sentinel', 'ha', 'netinfo.json');
    try {
      if (!fs.existsSync(netinfoPath)) return { ok: true, netinfo: null };
      const raw = fs.readFileSync(netinfoPath, 'utf8');
      const netinfo = JSON.parse(raw);
      return { ok: true, netinfo };
    } catch {
      return { ok: true, netinfo: null };
    }
  });

  const HA_CONFIG_KEY = 'cluster_ha_config';
  const HA_AUTH_SECRET = 'cluster_ha_auth_pass';
  const haConfigPath = path.join(config.DATA_DIR || '/data', 'sentinel', 'ha', 'config.json');
  const haRolePath = path.join(config.DATA_DIR || '/data', 'sentinel', 'cluster_role');

  app.get('/api/cluster/ha/config', async (request) => {
    await requireAdmin(db, request);
    const res = await db.pool.query('SELECT value FROM settings WHERE key = $1', [HA_CONFIG_KEY]);
    const value = res.rows?.[0]?.value;
    const cfg = value && typeof value === 'object' ? value : null;
    const hasAuthPass = await hasSecret(db, HA_AUTH_SECRET);
    return { ok: true, config: cfg, hasAuthPass };
  });

  app.put(
    '/api/cluster/ha/config',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['enabled'],
          properties: {
            enabled: { type: 'boolean' },
            vip: { type: 'string' },
            interface: { type: 'string' },
            vrid: { type: 'number' },
            priority: { type: 'number' },
            mode: { type: 'string', enum: ['multicast', 'unicast'] },
            unicastPeers: { type: 'array', items: { type: 'string' } },
            srcIp: { type: 'string' },
            advertInt: { type: 'number' },
            authPass: { type: 'string' }
          }
        }
      }
    },
    async (request: any) => {
      await requireAdmin(db, request);

      const enabled = Boolean(request.body?.enabled);
      const vip = String(request.body?.vip || '').trim();
      const iface = String(request.body?.interface || '').trim();
      const vrid = Number(request.body?.vrid ?? 53);
      const priority = Number(request.body?.priority ?? 110);
      const advertInt = Number(request.body?.advertInt ?? 1);
      const mode = (String(request.body?.mode || 'multicast') as 'multicast' | 'unicast');
      const srcIp = String(request.body?.srcIp || '').trim();

      const peersIn = Array.isArray(request.body?.unicastPeers) ? request.body.unicastPeers : [];
      const unicastPeers = peersIn.map((p: any) => String(p || '').trim()).filter(Boolean);

      const authPass = String(request.body?.authPass || '').trim();

      if (enabled) {
        if (!vip) {
          const err = new Error('MISSING_VIP');
          // @ts-expect-error Fastify maps this
          err.statusCode = 400;
          throw err;
        }
        if (!Number.isFinite(vrid) || vrid < 1 || vrid > 255) {
          const err = new Error('INVALID_VRID');
          // @ts-expect-error Fastify maps this
          err.statusCode = 400;
          throw err;
        }
        if (!Number.isFinite(priority) || priority < 1 || priority > 255) {
          const err = new Error('INVALID_PRIORITY');
          // @ts-expect-error Fastify maps this
          err.statusCode = 400;
          throw err;
        }
        if (mode === 'unicast' && unicastPeers.length === 0) {
          const err = new Error('MISSING_UNICAST_PEERS');
          // @ts-expect-error Fastify maps this
          err.statusCode = 400;
          throw err;
        }
        const alreadyHas = await hasSecret(db, HA_AUTH_SECRET);
        if (!authPass && !alreadyHas) {
          const err = new Error('MISSING_AUTH_PASS');
          // @ts-expect-error Fastify maps this
          err.statusCode = 400;
          throw err;
        }
      }

      const storedConfig = {
        enabled,
        vip: vip || undefined,
        interface: iface || undefined,
        vrid,
        priority,
        advertInt,
        mode,
        unicastPeers: unicastPeers.length ? unicastPeers : undefined,
        srcIp: srcIp || undefined
      };

      await db.pool.query(
        'INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
        [HA_CONFIG_KEY, storedConfig]
      );

      if (authPass) {
        await setSecret(db, config, HA_AUTH_SECRET, authPass);
      }

      // Write config for keepalived sidecar (plaintext by necessity).
      try {
        fs.mkdirSync(path.dirname(haConfigPath), { recursive: true });
        const effectiveAuthPass = authPass || (await getSecret(db, config, HA_AUTH_SECRET));
        const fileConfig = {
          ...storedConfig,
          authPass: enabled ? effectiveAuthPass : undefined
        };
        fs.writeFileSync(haConfigPath, JSON.stringify(fileConfig, null, 2), 'utf8');

        // If HA is disabled, remove any stale role override so Sentinel falls back to its configured role.
        if (!enabled) {
          try {
            if (fs.existsSync(haRolePath)) fs.unlinkSync(haRolePath);
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }

      return { ok: true };
    }
  );

  // Keepalived-friendly endpoint (no auth): use to decide whether this node is "ready".
  // For followers we require a recent successful sync.
  app.get('/api/cluster/ready', async () => {
    const status = await getClusterStatus(db);
    if (!status.config.enabled) return { ok: true, role: 'standalone' };
    const role = effectiveRole(config, status.config.role);
    if (role !== 'follower') return { ok: true, role };
    const last = status.lastSync ? Date.parse(status.lastSync) : 0;
    const ok = last > 0 && Date.now() - last < 20_000;
    return { ok, role: 'follower', lastSync: status.lastSync ?? null };
  });

  // Enable leader mode and ensure a cluster PSK exists.
  app.post(
    '/api/cluster/enable-leader',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            leaderUrl: { type: 'string' }
          }
        }
      }
    },
    async (request: any) => {
      await requireAdmin(db, request);
      const leaderUrl = String(request.body?.leaderUrl || '').trim();
      if (!leaderUrl || !/^https?:\/\//i.test(leaderUrl)) {
        const err = new Error('INVALID_LEADER_URL');
        // @ts-expect-error Fastify maps this
        err.statusCode = 400;
        throw err;
      }

      await ensureClusterPsk(db, config);
      await setClusterConfig(db, { enabled: true, role: 'leader', leaderUrl: leaderUrl.replace(/\/$/, '') });
      return { ok: true };
    }
  );

  // Generate a join code (copy/paste to a follower). Contains leaderUrl + PSK.
  app.get('/api/cluster/join-code', async (request: any) => {
    await requireAdmin(db, request);
    const status = await getClusterStatus(db);
    if (!status.config.enabled || status.config.role !== 'leader' || !status.config.leaderUrl) {
      const err = new Error('NOT_LEADER');
      // @ts-expect-error Fastify maps this
      err.statusCode = 409;
      throw err;
    }
    const joinCode = await makeLeaderJoinCode(db, config, status.config.leaderUrl);
    return { joinCode };
  });

  // Configure this node as follower from a leader-generated join code.
  app.post(
    '/api/cluster/configure-follower',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['joinCode'],
          properties: {
            joinCode: { type: 'string', minLength: 10 }
          }
        }
      }
    },
    async (request: any, reply: any) => {
      await requireAdmin(db, request);
      try {
        await configureFollowerFromJoinCode(db, config, String(request.body.joinCode));
        return { ok: true };
      } catch (e: any) {
        const code = String(e?.message || 'INVALID_JOIN_CODE');
        if (code === 'JOIN_CODE_EXPIRED' || code === 'INVALID_JOIN_CODE' || code === 'INVALID_LEADER_URL' || code === 'INVALID_PSK') {
          reply.code(400);
          return { error: code };
        }
        throw e;
      }
    }
  );

  // Cluster-internal export endpoint (followers pull from leader).
  app.post(
    '/api/cluster/sync/export',
    {
      config: {
        // Internal endpoint: follower sync loop polls every few seconds.
        // Keep this high enough for normal operation, but prevent abuse.
        rateLimit: { max: 240, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit()
    },
    async (request: any) => {
    await requireClusterAuth(db, config, request);

    const status = await getClusterStatus(db);
    const role = effectiveRole(config, status.config.role);
    if (!status.config.enabled || role !== 'leader') {
      const err = new Error('NOT_LEADER');
      // @ts-expect-error Fastify maps this
      err.statusCode = 409;
      throw err;
    }

    // Settings (excluding encrypted secrets + cluster internals)
    const settingsRes = await db.pool.query(
      "SELECT key, value, updated_at FROM settings WHERE key NOT LIKE 'secret:%' AND key NOT LIKE 'cluster_%' ORDER BY key ASC"
    );

    // Clients
    const clientsRes = await db.pool.query('SELECT id, profile, updated_at FROM clients ORDER BY id ASC');

    // Manual rules (non-blocklist)
    const rulesRes = await db.pool.query(
      "SELECT domain, type, category, created_at FROM rules WHERE category NOT ILIKE 'blocklist:%' ORDER BY id ASC"
    );

    // Blocklists config
    const blocklistsRes = await db.pool.query(
      'SELECT id, name, url, enabled, mode, last_updated_at, last_error, last_rule_count, created_at, updated_at FROM blocklists ORDER BY id ASC'
    );

    // Secrets: export in plaintext over cluster-auth channel so followers can re-encrypt with their own SECRETS_KEY.
    const secretKeysRes = await db.pool.query("SELECT key FROM settings WHERE key LIKE 'secret:%' ORDER BY key ASC");
    const secrets: Array<{ name: string; value: string }> = [];
    for (const row of secretKeysRes.rows ?? []) {
      const key = String(row?.key || '');
      const name = key.startsWith('secret:') ? key.slice('secret:'.length) : '';
      if (!name) continue;
      const value = await getSecret(db, config, name);
      secrets.push({ name, value });
    }

    const snapshot: ClusterExportSnapshot = {
      exportedAt: new Date().toISOString(),
      nodeId: status.nodeId,
      settings: (settingsRes.rows ?? []).map((r: any) => ({
        key: String(r.key),
        value: r.value,
        updatedAt: new Date(r.updated_at).toISOString()
      })),
      clients: (clientsRes.rows ?? []).map((r: any) => ({
        id: String(r.id),
        profile: r.profile,
        updatedAt: new Date(r.updated_at).toISOString()
      })),
      rules: (rulesRes.rows ?? []).map((r: any) => ({
        domain: String(r.domain),
        type: String(r.type),
        category: String(r.category),
        createdAt: new Date(r.created_at).toISOString()
      })),
      blocklists: (blocklistsRes.rows ?? []).map((r: any) => ({
        id: Number(r.id),
        name: String(r.name),
        url: String(r.url),
        enabled: Boolean(r.enabled),
        mode: String(r.mode),
        lastUpdatedAt: r.last_updated_at ? new Date(r.last_updated_at).toISOString() : null,
        lastError: r.last_error ? String(r.last_error) : null,
        lastRuleCount: Number(r.last_rule_count ?? 0),
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString()
      })),
      secrets
    };

    return snapshot;
    }
  );
}
