import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import crypto from 'node:crypto';
import { setSecret } from '../../src/secretsStore.js';
import { signClusterRequest } from '../../src/cluster/hmac.js';
import { setClusterConfig } from '../../src/cluster/store.js';
import { loadConfig } from '../../src/config.js';

import { hasDocker, startPostgresContainer } from './_harness.js';

describe('integration: cluster HMAC auth', () => {
  let dockerOk = false;
  let pg: Awaited<ReturnType<typeof startPostgresContainer>> | null = null;
  let closeApp: (() => Promise<void>) | null = null;
  let app: any;
  let db: any;
  let config: any;

  beforeAll(async () => {
    dockerOk = await hasDocker();
    if (!dockerOk) return;

    pg = await startPostgresContainer();

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = pg.databaseUrl;
    process.env.ENABLE_DNS = 'false';
    process.env.FRONTEND_ORIGIN = 'http://localhost';
    process.env.SECRETS_KEY = `it-hmac-${crypto.randomBytes(8).toString('hex')}`;

    const cfg = loadConfig();
    const { buildApp } = await import('../../src/app.js');
    const built = await buildApp(cfg, {
      enableDns: false,
      enableStatic: false,
      enableBlocklistRefreshJobs: false
    });

    app = built.app;
    db = built.db;
    config = cfg;
    closeApp = built.close;

    // Ensure we are in leader mode so /api/cluster/sync/export can respond.
    await setClusterConfig(db, { enabled: true, role: 'leader', leaderUrl: 'http://localhost:8080' });

    // Set a known PSK.
    const secret = `psk-${crypto.randomBytes(12).toString('hex')}`;
    await setSecret(db, config, 'cluster_psk', secret);

    // Store on app instance for tests.
    (globalThis as any).__clusterPsk = secret;
  }, 120_000);

  afterAll(async () => {
    try {
      await closeApp?.();
    } catch {
      // ignore
    }
    await pg?.stop().catch(() => undefined);
    delete (globalThis as any).__clusterPsk;
  }, 120_000);

  it('skips if Docker is unavailable', async () => {
    if (!dockerOk) {
      expect(dockerOk).toBe(false);
      return;
    }
    expect(dockerOk).toBe(true);
  });

  it('rejects /api/cluster/sync/export without auth headers', async () => {
    if (!dockerOk) return;

    const res = await app.inject({ method: 'POST', url: '/api/cluster/sync/export', payload: { want: 'full' } });
    expect(res.statusCode).toBe(401);
  });

  it('accepts valid HMAC headers for /api/cluster/sync/export', async () => {
    if (!dockerOk) return;

    const secret = String((globalThis as any).__clusterPsk);
    const path = '/api/cluster/sync/export';
    const body = { want: 'full' };

    const headers = signClusterRequest({ secret, method: 'POST', path, body });
    const res = await app.inject({
      method: 'POST',
      url: path,
      headers: { ...headers, 'content-type': 'application/json' },
      payload: body
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('exportedAt');
    expect(res.json()).toHaveProperty('settings');
  });

  it('rejects requests with timestamp skew (TS_SKEW)', async () => {
    if (!dockerOk) return;

    const secret = String((globalThis as any).__clusterPsk);
    const path = '/api/cluster/sync/export';
    const body = { want: 'full' };

    const headers = signClusterRequest({ secret, method: 'POST', path, body, tsMs: Date.now() - 5 * 60 * 1000 });
    const res = await app.inject({
      method: 'POST',
      url: path,
      headers: { ...headers, 'content-type': 'application/json' },
      payload: body
    });

    // We currently map all cluster auth failures to 401.
    expect(res.statusCode).toBe(401);
  });

  it('rejects nonce replay within skew window', async () => {
    if (!dockerOk) return;

    const secret = String((globalThis as any).__clusterPsk);
    const path = '/api/cluster/sync/export';
    const body = { want: 'full' };

    const fixedNonce = 'fixed-nonce';
    const fixedTs = Date.now();

    const headers1 = signClusterRequest({ secret, method: 'POST', path, body, nonce: fixedNonce, tsMs: fixedTs });
    const first = await app.inject({
      method: 'POST',
      url: path,
      headers: { ...headers1, 'content-type': 'application/json' },
      payload: body
    });
    expect(first.statusCode).toBe(200);

    const headers2 = signClusterRequest({ secret, method: 'POST', path, body, nonce: fixedNonce, tsMs: fixedTs });
    const second = await app.inject({
      method: 'POST',
      url: path,
      headers: { ...headers2, 'content-type': 'application/json' },
      payload: body
    });

    expect(second.statusCode).toBe(401);
  });
});
