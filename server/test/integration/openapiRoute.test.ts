import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractSessionCookie, hasDocker, startPostgresContainer, startTestApp } from './_harness.js';

describe('integration: openapi route', () => {
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

    // Configure auth once.
    const username = `it-${Date.now()}`;
    const password = `it-pass-${Math.random().toString(16).slice(2)}-12345678`;

    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username, password }
    });

    expect(setup.statusCode).toBe(200);
    const cookie = extractSessionCookie(setup.headers['set-cookie']);
    expect(cookie).toBeTruthy();

    // stash on app instance for tests
    (app as any).__cookie = cookie;
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

  it('serves OpenAPI JSON for authenticated admin', async () => {
    if (!dockerOk) return;

    const cookie = (app as any).__cookie as string;
    const res = await app.inject({ method: 'GET', url: '/api/openapi.json', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toHaveProperty('openapi', '3.0.0');
    expect(json).toHaveProperty('info');
    expect(json.info).toHaveProperty('title');
  });
});
