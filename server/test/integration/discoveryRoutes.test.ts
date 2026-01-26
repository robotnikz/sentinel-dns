import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { extractSessionCookie, hasDocker, startPostgresContainer, startTestApp } from './_harness.js';

describe('integration: discovery routes', () => {
  let dockerOk = false;
  let pg: Awaited<ReturnType<typeof startPostgresContainer>> | null = null;
  let closeApp: (() => Promise<void>) | null = null;
  let app: any;
  let cookie = '';
  let pool: Pool | null = null;

  beforeAll(async () => {
    dockerOk = await hasDocker();
    if (!dockerOk) return;

    pg = await startPostgresContainer();
    pool = new Pool({ connectionString: pg.databaseUrl });

    const built = await startTestApp(pg.databaseUrl);
    app = built.app;
    closeApp = built.close;

    const username = `it-${Date.now()}`;
    const password = `it-pass-${Math.random().toString(16).slice(2)}-12345678`;

    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username, password }
    });

    cookie = extractSessionCookie(setup.headers['set-cookie']);
    if (!cookie) throw new Error('Missing session cookie from /api/auth/setup');

    await pool.query('DELETE FROM query_logs');
    await pool.query('INSERT INTO query_logs(entry) VALUES ($1), ($2)', [
      { domain: 'x.test', status: 'PERMITTED', clientIp: '127.0.0.1' },
      { domain: 'y.test', status: 'PERMITTED', clientIp: '192.168.1.5' }
    ]);
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => undefined);
    try {
      await closeApp?.();
    } catch {
      // ignore
    }
    await pg?.stop().catch(() => undefined);
  }, 120_000);

  it('skips if Docker is unavailable', async () => {
    if (!dockerOk) {
      expect(dockerOk).toBe(false);
      return;
    }
    expect(dockerOk).toBe(true);
  });

  it('GET/PUT /api/discovery/settings normalizes and persists', async () => {
    if (!dockerOk) return;

    const get1 = await app.inject({ method: 'GET', url: '/api/discovery/settings', headers: { cookie } });
    expect(get1.statusCode).toBe(200);
    expect(get1.json()).toHaveProperty('value');

    const put = await app.inject({
      method: 'PUT',
      url: '/api/discovery/settings',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { reverseDns: { enabled: true, resolver: '', timeoutMs: 50 } }
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ ok: true });

    const get2 = await app.inject({ method: 'GET', url: '/api/discovery/settings', headers: { cookie } });
    expect(get2.statusCode).toBe(200);
    expect(get2.json()?.value?.reverseDns?.enabled).toBe(true);
  });

  it('POST /api/discovery/test-ptr validates IP and returns a stable shape', async () => {
    if (!dockerOk) return;

    const bad = await app.inject({
      method: 'POST',
      url: '/api/discovery/test-ptr',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { ip: 'not-an-ip' }
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'INVALID_IP' });

    const ok = await app.inject({
      method: 'POST',
      url: '/api/discovery/test-ptr',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { ip: '127.0.0.1', resolver: '127.0.0.1', timeoutMs: 50 }
    });
    expect(ok.statusCode).toBe(200);
    const json = ok.json();
    expect(json).toHaveProperty('ip', '127.0.0.1');
    expect(json).toHaveProperty('names');
    expect(json).toHaveProperty('hostname');
    expect(typeof json.durationMs).toBe('number');
  });

  it('GET /api/discovery/clients returns observed list and (optionally) reverse-dns mode', async () => {
    if (!dockerOk) return;

    // Previous tests may have enabled reverseDns; force a known baseline.
    await app.inject({
      method: 'PUT',
      url: '/api/discovery/settings',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { reverseDns: { enabled: false, resolver: '', timeoutMs: 50 } }
    });

    // With reverseDns disabled (default), we should get observed mode.
    const res1 = await app.inject({ method: 'GET', url: '/api/discovery/clients?limit=20', headers: { cookie } });
    expect(res1.statusCode).toBe(200);
    const items1 = Array.isArray(res1.json()?.items) ? res1.json().items : [];
    expect(items1.length).toBeGreaterThan(0);
    expect(items1[0]).toHaveProperty('source', 'observed');

    // Enable reverse DNS with a small timeout to keep test deterministic.
    await app.inject({
      method: 'PUT',
      url: '/api/discovery/settings',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { reverseDns: { enabled: true, resolver: '', timeoutMs: 50 } }
    });

    const res2 = await app.inject({ method: 'GET', url: '/api/discovery/clients?limit=20', headers: { cookie } });
    expect(res2.statusCode).toBe(200);
    const items2 = Array.isArray(res2.json()?.items) ? res2.json().items : [];
    expect(items2.length).toBeGreaterThan(0);
    expect(items2[0]).toHaveProperty('source', 'reverse-dns');
  });
});
