import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { extractSessionCookie, hasDocker, startPostgresContainer, startTestApp } from './_harness.js';

describe('integration: authz gates', () => {
  let dockerOk = false;
  let pg: Awaited<ReturnType<typeof startPostgresContainer>> | null = null;
  let closeApp: (() => Promise<void>) | null = null;
  let app: any;

  beforeAll(async () => {
    dockerOk = await hasDocker();
    if (!dockerOk) return;

    pg = await startPostgresContainer();
    const built = await startTestApp(pg.databaseUrl);
    app = built.app;
    closeApp = built.close;
  }, 120_000);

  afterAll(async () => {
    try {
      await closeApp?.();
    } catch {
      // ignore
    }
    await pg?.stop().catch(() => undefined);
  }, 120_000);

  it('skips if Docker is unavailable', async () => {
    if (!dockerOk) {
      // Keep this test passing but informative.
      expect(dockerOk).toBe(false);
      return;
    }
    expect(dockerOk).toBe(true);
  });

  it('allows /api/health without auth', async () => {
    if (!dockerOk) return;
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
  });

  it('allows /api/version without auth', async () => {
    if (!dockerOk) return;
    const res = await app.inject({ method: 'GET', url: '/api/version' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('version');
  });

  it('rejects protected endpoints without cookie', async () => {
    if (!dockerOk) return;

    const endpoints: Array<{ method: 'GET' | 'POST' | 'PUT' | 'DELETE'; url: string; payload?: any }> = [
      { method: 'GET', url: '/api/settings' },
      { method: 'PUT', url: '/api/settings/test_key', payload: { any: 'value' } },
      { method: 'GET', url: '/api/query-logs' },
      { method: 'GET', url: '/api/metrics/summary' },
      { method: 'GET', url: '/api/metrics/timeseries' },
      { method: 'GET', url: '/api/metrics/top-domains' },
      { method: 'GET', url: '/api/metrics/top-blocked' },
      { method: 'GET', url: '/api/metrics/clients' },
      { method: 'GET', url: '/api/clients' },
      { method: 'GET', url: '/api/blocklists' },
      { method: 'GET', url: '/api/secrets/status' },
      { method: 'PUT', url: '/api/secrets/gemini_api_key', payload: { value: 'x' } },
      { method: 'GET', url: '/api/ai/status' },
      { method: 'GET', url: '/api/rules' },
      { method: 'GET', url: '/api/dns/settings' },
      { method: 'GET', url: '/api/geoip/status' },
      { method: 'POST', url: '/api/geoip/update', payload: { licenseKey: 'x' } },
      { method: 'GET', url: '/api/tailscale/status' },
      { method: 'POST', url: '/api/tailscale/auth-url' },
      { method: 'GET', url: '/api/notifications/feed' },
      { method: 'GET', url: '/api/notifications/feed/unread-count' },
      { method: 'POST', url: '/api/notifications/feed/mark-read', payload: { all: true } },
      { method: 'POST', url: '/api/notifications/discord/test', payload: {} },
      { method: 'GET', url: '/api/protection/pause' },
      { method: 'PUT', url: '/api/protection/pause', payload: { mode: 'OFF' } },
      { method: 'GET', url: '/api/openapi.json' },
      { method: 'GET', url: '/api/cluster/status' },
      { method: 'GET', url: '/api/ui/status' }
    ];

    for (const endpoint of endpoints) {
      const res = await app.inject({ method: endpoint.method, url: endpoint.url, payload: endpoint.payload });
      expect(res.statusCode, `Expected 401 for ${endpoint.method} ${endpoint.url}`).toBe(401);
    }
  });

  it('auth setup issues session cookie and enables access', async () => {
    if (!dockerOk) return;

    const username = `it-${Date.now()}`;
    const password = `it-pass-${crypto.randomBytes(8).toString('hex')}-12345678`;

    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username, password }
    });

    expect(setup.statusCode).toBe(200);

    const setCookie = setup.headers['set-cookie'];
    expect(setCookie).toBeTruthy();
    const cookie = extractSessionCookie(setCookie);
    expect(cookie).toBeTruthy();

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ loggedIn: true, username });

    const settings = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } });
    expect(settings.statusCode).toBe(200);
    expect(settings.json()).toHaveProperty('items');
  });
});
