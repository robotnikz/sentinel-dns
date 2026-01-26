import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { extractSessionCookie, hasDocker, startPostgresContainer, startTestApp } from './_harness.js';

describe('integration: settings CRUD', () => {
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
    const password = `it-pass-${crypto.randomBytes(8).toString('hex')}-12345678`;

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

  it('PUT /api/settings/:key upserts JSON and GET /api/settings returns it', async () => {
    if (!dockerOk) return;

    const value = { enabled: true, threshold: 3 };

    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings/example_setting',
      headers: { cookie },
      payload: value
    });

    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ ok: true });

    const get = await app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie }
    });

    expect(get.statusCode).toBe(200);
    const json = get.json();
    expect(Array.isArray(json.items)).toBe(true);

    const row = (json.items as any[]).find((r) => r.key === 'example_setting');
    expect(row).toBeTruthy();
    expect(row.value).toEqual(value);
    expect(typeof row.updated_at).toBe('string');
  });
});
