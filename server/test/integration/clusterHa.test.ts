import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';

import type { AppConfig } from '../../src/config.js';
import { loadConfig } from '../../src/config.js';
import { setSecret, getSecret } from '../../src/secretsStore.js';
import { runFollowerSyncOnce } from '../../src/cluster/sync.js';
import { extractSessionCookie, hasDocker, startPostgresContainer } from './_harness.js';

type StartedApp = {
  app: any;
  db: any;
  config: AppConfig;
  close: () => Promise<void>;
  baseUrl?: string;
};

function makeDbUrl(baseUrl: string, dbName: string): string {
  // baseUrl looks like: postgres://user:pw@127.0.0.1:1234/sentinel
  return baseUrl.replace(/\/[^/?#]+(\?|#|$)/, `/${dbName}$1`);
}

async function createDatabase(adminUrl: string, dbName: string): Promise<void> {
  const pool = new Pool({ connectionString: adminUrl });
  try {
    await pool.query(`CREATE DATABASE ${JSON.stringify(dbName).slice(1, -1)}`);
  } catch {
    // Some Postgres versions don't like quoted identifiers via JSON trick.
    // Fallback: use safe-ish identifier (we control dbName format).
    await pool.query(`CREATE DATABASE ${dbName}`);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function startApp(params: {
  databaseUrl: string;
  secretsKey: string;
  clusterRoleFile?: string;
  listen?: boolean;
}): Promise<StartedApp> {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = params.databaseUrl;
  process.env.ENABLE_DNS = 'false';
  process.env.FRONTEND_ORIGIN = 'http://localhost';
  process.env.SECRETS_KEY = params.secretsKey;

  if (params.clusterRoleFile !== undefined) process.env.CLUSTER_ROLE_FILE = params.clusterRoleFile;
  else delete process.env.CLUSTER_ROLE_FILE;

  const config = loadConfig();
  const { buildApp } = await import('../../src/app.js');
  const built = await buildApp(config, {
    enableDns: false,
    enableStatic: false,
    enableBlocklistRefreshJobs: false
  });

  let baseUrl: string | undefined;
  if (params.listen) {
    await built.app.listen({ host: '127.0.0.1', port: 0 });
    const addr = built.app.server.address();
    const port = typeof addr === 'object' && addr ? (addr as any).port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  }

  return { app: built.app, db: built.db, config, close: built.close, baseUrl };
}

function decodeJoinCode(joinCode: string): any {
  const raw = Buffer.from(joinCode, 'base64url').toString('utf8');
  return JSON.parse(raw);
}

function encodeJoinCode(obj: any): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

describe('integration: cluster/HA + sync (MVP)', () => {
  let dockerOk = false;
  let pg: Awaited<ReturnType<typeof startPostgresContainer>> | null = null;

  let leader: StartedApp | null = null;
  let follower: StartedApp | null = null;

  let leaderCookie = '';
  let followerCookie = '';

  let adminUsername = '';
  let adminPassword = '';

  let tempDir = '';

  beforeAll(async () => {
    dockerOk = await hasDocker();
    if (!dockerOk) return;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-it-cluster-'));

    pg = await startPostgresContainer();

    // Create two separate DBs in the same Postgres container to simulate two nodes.
    const suffix = crypto.randomBytes(6).toString('hex');
    const leaderDb = `sentinel_leader_${suffix}`;
    const followerDb = `sentinel_follower_${suffix}`;

    const adminPool = new Pool({ connectionString: pg.databaseUrl });
    try {
      await adminPool.query(`CREATE DATABASE ${leaderDb}`);
      await adminPool.query(`CREATE DATABASE ${followerDb}`);
    } finally {
      await adminPool.end().catch(() => undefined);
    }

    const leaderUrl = makeDbUrl(pg.databaseUrl, leaderDb);
    const followerUrl = makeDbUrl(pg.databaseUrl, followerDb);

    leader = await startApp({ databaseUrl: leaderUrl, secretsKey: `leader-${suffix}`, listen: true });
    follower = await startApp({ databaseUrl: followerUrl, secretsKey: `follower-${suffix}`, listen: false });

    // Setup admin session on both nodes.
    {
      adminUsername = `it-admin-${Date.now()}`;
      adminPassword = `it-pass-${crypto.randomBytes(8).toString('hex')}-12345678`;

      const setup = await leader.app.inject({
        method: 'POST',
        url: '/api/auth/setup',
        payload: { username: adminUsername, password: adminPassword }
      });
      leaderCookie = extractSessionCookie(setup.headers['set-cookie']);
      if (!leaderCookie) throw new Error('Missing leader session cookie from /api/auth/setup');
    }

    {
      const setup = await follower.app.inject({
        method: 'POST',
        url: '/api/auth/setup',
        payload: { username: adminUsername, password: adminPassword }
      });
      followerCookie = extractSessionCookie(setup.headers['set-cookie']);
      if (!followerCookie) throw new Error('Missing follower session cookie from /api/auth/setup');
    }

    // Enable leader mode with an HTTP-reachable base URL.
    const enableLeader = await leader.app.inject({
      method: 'POST',
      url: '/api/cluster/enable-leader',
      headers: { cookie: leaderCookie, 'content-type': 'application/json' },
      payload: { leaderUrl: leader.baseUrl }
    });
    expect(enableLeader.statusCode).toBe(200);

    // Configure follower from join code.
    const join = await leader.app.inject({ method: 'GET', url: '/api/cluster/join-code', headers: { cookie: leaderCookie } });
    expect(join.statusCode, join.body).toBe(200);
    const joinCode = String(join.json()?.joinCode || '');
    expect(joinCode.length).toBeGreaterThan(20);

    const configFollower = await follower.app.inject({
      method: 'POST',
      url: '/api/cluster/configure-follower',
      headers: { cookie: followerCookie, 'content-type': 'application/json' },
      payload: { joinCode }
    });
    expect(configFollower.statusCode).toBe(200);

    // Seed leader data for sync.
    // Do not clear auth/session settings here; they are required for subsequent admin calls.
    await leader.db.pool.query("DELETE FROM settings WHERE key = 'some_setting'");
    await leader.db.pool.query("DELETE FROM settings WHERE key = 'secret:gemini_api_key'");
    await leader.db.pool.query('DELETE FROM clients');
    await leader.db.pool.query("DELETE FROM rules WHERE category NOT ILIKE 'blocklist:%'");
    await leader.db.pool.query('TRUNCATE blocklists');

    await leader.db.pool.query(
      "INSERT INTO settings(key, value) VALUES ('some_setting', $1)",
      [{ ok: true, at: new Date().toISOString() }]
    );

    await leader.db.pool.query('INSERT INTO clients(id, profile) VALUES ($1, $2)', [
      `c-${suffix}`,
      { id: `c-${suffix}`, name: 'ClusterClient', type: 'laptop', assignedBlocklists: [1] }
    ]);

    await leader.db.pool.query('INSERT INTO rules(domain, type, category) VALUES ($1, $2, $3)', [
      `blocked-${suffix}.test`,
      'BLOCKED',
      'Manual'
    ]);

    await leader.db.pool.query(
      'INSERT INTO blocklists(id, name, url, enabled, mode, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,NOW(),NOW())',
      [1, 'Example', `https://example.com/${suffix}.txt`, true, 'ACTIVE']
    );

    await setSecret(leader.db, leader.config, 'gemini_api_key', `secret-${suffix}`);
  }, 180_000);

  afterAll(async () => {
    try {
      await leader?.close();
    } catch {
      // ignore
    }
    try {
      await follower?.close();
    } catch {
      // ignore
    }
    await pg?.stop().catch(() => undefined);
    try {
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }, 180_000);

  it('skips if Docker is unavailable', async () => {
    if (!dockerOk) {
      expect(dockerOk).toBe(false);
      return;
    }
    expect(dockerOk).toBe(true);
  });

  it('join code contains leaderUrl + psk', async () => {
    if (!dockerOk) return;
    if (!leader) throw new Error('leader not initialized');

    const join = await leader.app.inject({ method: 'GET', url: '/api/cluster/join-code', headers: { cookie: leaderCookie } });
    expect(join.statusCode).toBe(200);

    const joinCode = String(join.json()?.joinCode || '');
    const decoded = decodeJoinCode(joinCode);
    expect(decoded).toHaveProperty('leaderUrl');
    expect(decoded).toHaveProperty('psk');
    expect(String(decoded.leaderUrl)).toMatch(/^http:\/\//);
    expect(String(decoded.psk).length).toBeGreaterThan(10);
  });

  it('expired join code is rejected (JOIN_CODE_EXPIRED)', async () => {
    if (!dockerOk) return;
    if (!leader || !follower) throw new Error('apps not initialized');

    // Load a join code and then backdate it beyond the default TTL (60 minutes).
    const join = await leader.app.inject({ method: 'GET', url: '/api/cluster/join-code', headers: { cookie: leaderCookie } });
    expect(join.statusCode).toBe(200);
    const joinCode = String(join.json()?.joinCode || '');
    const decoded = decodeJoinCode(joinCode);
    decoded.createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const expired = encodeJoinCode(decoded);

    const res = await follower.app.inject({
      method: 'POST',
      url: '/api/cluster/configure-follower',
      headers: { cookie: followerCookie, 'content-type': 'application/json' },
      payload: { joinCode: expired }
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'JOIN_CODE_EXPIRED' });
  });

  it('follower sync applies snapshot (settings, clients, rules, blocklists, secrets)', async () => {
    if (!dockerOk) return;
    if (!leader || !follower) throw new Error('apps not initialized');

    // Before sync: follower should not have the leader state.
    const pre = await follower.db.pool.query("SELECT value FROM settings WHERE key = 'some_setting'");
    expect(pre.rowCount).toBe(0);

    await runFollowerSyncOnce(follower.config, follower.db);

    const s = await follower.db.pool.query("SELECT value FROM settings WHERE key = 'some_setting'");
    expect(s.rowCount).toBe(1);
    expect(s.rows?.[0]?.value).toMatchObject({ ok: true });

    const c = await follower.db.pool.query('SELECT id, profile FROM clients');
    expect(c.rowCount).toBe(1);
    expect(String(c.rows?.[0]?.id || '')).toMatch(/^c-/);

    const r = await follower.db.pool.query('SELECT domain, type, category FROM rules');
    expect(r.rowCount).toBe(1);
    expect(String(r.rows?.[0]?.type)).toBe('BLOCKED');

    const b = await follower.db.pool.query('SELECT id, name, url, enabled, mode FROM blocklists');
    expect(b.rowCount).toBe(1);
    expect(Number(b.rows?.[0]?.id)).toBe(1);

    const secret = await getSecret(follower.db, follower.config, 'gemini_api_key');
    expect(secret).toMatch(/^secret-/);

    // Follower should be considered ready shortly after a successful sync.
    const ready = await follower.app.inject({ method: 'GET', url: '/api/cluster/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ ok: true, role: 'follower' });
  });

  it('follower sync removes clients deleted on leader', async () => {
    if (!dockerOk) return;
    if (!leader || !follower) throw new Error('apps not initialized');

    // Ensure follower has the leader client first.
    await runFollowerSyncOnce(follower.config, follower.db);
    const before = await follower.db.pool.query('SELECT id FROM clients');
    expect(before.rowCount).toBeGreaterThan(0);

    // Delete all clients on the leader, then sync again.
    await leader.db.pool.query('DELETE FROM clients');
    await runFollowerSyncOnce(follower.config, follower.db);

    const after = await follower.db.pool.query('SELECT id FROM clients');
    expect(after.rowCount).toBe(0);
  });

  it('follower rejects mutations with FOLLOWER_READONLY', async () => {
    if (!dockerOk) return;
    if (!follower) throw new Error('follower not initialized');

    // Snapshot sync clears sessions to avoid carrying active sessions across nodes.
    // Re-login so we can assert the follower read-only guard (409) instead of auth (401).
    const login = await follower.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { username: adminUsername, password: adminPassword }
    });
    expect(login.statusCode, login.body).toBe(200);
    const freshCookie = extractSessionCookie(login.headers['set-cookie']);
    expect(freshCookie).toBeTruthy();

    const id = `ro-${Date.now()}`;
    const res = await follower.app.inject({
      method: 'PUT',
      url: `/api/clients/${id}`,
      headers: { cookie: freshCookie, 'content-type': 'application/json' },
      payload: { id, name: 'Should fail', type: 'laptop' }
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'FOLLOWER_READONLY' });

    const exists = await follower.db.pool.query('SELECT 1 FROM clients WHERE id = $1', [id]);
    expect(exists.rowCount).toBe(0);
  });

  it('role override file makes node effectively leader (and stops follower sync)', async () => {
    if (!dockerOk) return;
    if (!leader || !follower) throw new Error('apps not initialized');

    // Simulate a stale lastSync so readiness cannot rely on recent sync.
    await follower.db.pool.query(
      "INSERT INTO settings(key, value) VALUES ('cluster_meta', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
      [{ lastSync: new Date(Date.now() - 60_000).toISOString() }]
    );

    const roleFile = path.join(tempDir, `role-${Date.now()}.txt`);
    fs.writeFileSync(roleFile, 'leader\n', 'utf8');

    // Start a second follower instance with role override pointing to leader.
    const followerRole = await startApp({
      databaseUrl: follower.config.DATABASE_URL,
      secretsKey: follower.config.SECRETS_KEY,
      clusterRoleFile: roleFile,
      listen: false
    });

    try {
      const ready = await followerRole.app.inject({ method: 'GET', url: '/api/cluster/ready' });
      expect(ready.statusCode).toBe(200);
      expect(ready.json()).toMatchObject({ ok: true, role: 'leader' });

      // Even while effectively leader (VIP owner), a configured follower must remain read-only.
      const login = await followerRole.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'content-type': 'application/json' },
        payload: { username: adminUsername, password: adminPassword }
      });
      expect(login.statusCode, login.body).toBe(200);
      const freshCookie = extractSessionCookie(login.headers['set-cookie']);
      expect(freshCookie).toBeTruthy();

      const id = `ro-override-${Date.now()}`;
      const mutation = await followerRole.app.inject({
        method: 'PUT',
        url: `/api/clients/${id}`,
        headers: { cookie: freshCookie, 'content-type': 'application/json' },
        payload: { id, name: 'Should fail', type: 'laptop' }
      });
      expect(mutation.statusCode).toBe(409);
      expect(mutation.json()).toMatchObject({ error: 'FOLLOWER_READONLY' });

      // Prove sync won't run when effective role is leader.
      await followerRole.db.pool.query("DELETE FROM settings WHERE key = 'some_setting'");
      await runFollowerSyncOnce(followerRole.config, followerRole.db);
      const s = await followerRole.db.pool.query("SELECT value FROM settings WHERE key = 'some_setting'");
      expect(s.rowCount).toBe(0);
    } finally {
      await followerRole.close().catch(() => undefined);
    }
  });
});
