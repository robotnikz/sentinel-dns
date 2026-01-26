import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractSessionCookie, hasDocker, startPostgresContainer, startTestApp } from './_harness.js';

describe('integration: geoip + tailscale status endpoints', () => {
  let dockerOk = false;
  let pg: Awaited<ReturnType<typeof startPostgresContainer>> | null = null;
  let closeApp: (() => Promise<void>) | null = null;
  let app: any;
  let cookie = '';

  beforeAll(async () => {
    dockerOk = await hasDocker();
    if (!dockerOk) return;

    pg = await startPostgresContainer();
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
      expect(dockerOk).toBe(false);
      return;
    }
    expect(dockerOk).toBe(true);
  });

  it('GET /api/geoip/status returns a valid shape without network access', async () => {
    if (!dockerOk) return;

    const res = await app.inject({
      method: 'GET',
      url: '/api/geoip/status',
      headers: { cookie }
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toHaveProperty('geoip');
    expect(typeof json.geoip?.available).toBe('boolean');
    expect(typeof json.geoip?.dbPath).toBe('string');
    expect(typeof json.hasLicenseKey).toBe('boolean');
  });

  it('GET /api/tailscale/status degrades gracefully when tailscale is unavailable', async () => {
    if (!dockerOk) return;

    const res = await app.inject({
      method: 'GET',
      url: '/api/tailscale/status',
      headers: { cookie }
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toHaveProperty('supported', true);
    expect(typeof json.running).toBe('boolean');
    // If tailscale isn't present, the endpoint returns running=false with error info.
    if (json.running === false) {
      expect(typeof json.error).toBe('string');
      expect(typeof json.message).toBe('string');
    }
  });

  it('POST /api/tailscale/auth-url returns either an auth URL or a graceful error', async () => {
    if (!dockerOk) return;

    const res = await app.inject({
      method: 'POST',
      url: '/api/tailscale/auth-url',
      headers: { cookie }
    });

    expect([200, 502]).toContain(res.statusCode);
    const json = res.json();
    expect(typeof json.ok).toBe('boolean');

    if (json.ok === true) {
      expect(typeof json.authUrl).toBe('string');
    } else {
      expect(typeof json.error).toBe('string');
      expect(typeof json.message).toBe('string');
    }
  });
});
