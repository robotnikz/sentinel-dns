import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractSessionCookie, hasDocker, startPostgresContainer, startTestApp } from './_harness.js';

describe('integration: rewrites CRUD', () => {
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

  it('creates and lists a rewrite', async () => {
    if (!dockerOk) return;

    const domain = `rewrite-${Date.now()}.example.com`;
    const target = '1.2.3.4';

    const created = await app.inject({
      method: 'POST',
      url: '/api/dns/rewrites',
      headers: { cookie },
      payload: { domain, target }
    });

    expect(created.statusCode).toBe(201);
    const createdJson = created.json();
    expect(createdJson).toHaveProperty('item');
    expect(createdJson.item).toHaveProperty('id');

    const list = await app.inject({ method: 'GET', url: '/api/dns/rewrites', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const items = Array.isArray(list.json()?.items) ? list.json().items : [];
    const present = items.some((r: any) => String(r?.domain).toLowerCase() === domain.toLowerCase());
    expect(present).toBe(true);
  });

  it('deletes a rewrite', async () => {
    if (!dockerOk) return;

    const domain = `rewrite-del-${Date.now()}.example.com`;
    const target = '1.2.3.4';

    const created = await app.inject({
      method: 'POST',
      url: '/api/dns/rewrites',
      headers: { cookie },
      payload: { domain, target }
    });

    expect(created.statusCode).toBe(201);
    const id = created.json()?.item?.id;
    expect(id).toBeTruthy();

    const del = await app.inject({ method: 'DELETE', url: `/api/dns/rewrites/${id}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);

    const list = await app.inject({ method: 'GET', url: '/api/dns/rewrites', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const items = Array.isArray(list.json()?.items) ? list.json().items : [];
    const present = items.some((r: any) => String(r?.id) === String(id));
    expect(present).toBe(false);
  });
});
