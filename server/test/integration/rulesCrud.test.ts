import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractSessionCookie, hasDocker, startPostgresContainer, startTestApp } from './_harness.js';

describe('integration: rules CRUD', () => {
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

  it('creates, lists and deletes a rule', async () => {
    if (!dockerOk) return;

    const domain = `block-${Date.now()}.example.com`;

    const created = await app.inject({
      method: 'POST',
      url: '/api/rules',
      headers: { cookie },
      payload: { domain, type: 'BLOCKED', category: 'IntegrationTest' }
    });

    expect(created.statusCode).toBe(201);
    const createdJson = created.json();
    expect(createdJson).toHaveProperty('id');

    const list = await app.inject({ method: 'GET', url: '/api/rules', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const items = Array.isArray(list.json()?.items) ? list.json().items : [];
    const present = items.some((r: any) => String(r?.domain).toLowerCase() === domain.toLowerCase());
    expect(present).toBe(true);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/rules/${createdJson.id}`,
      headers: { cookie }
    });
    expect(del.statusCode).toBe(204);

    const list2 = await app.inject({ method: 'GET', url: '/api/rules', headers: { cookie } });
    expect(list2.statusCode).toBe(200);
    const items2 = Array.isArray(list2.json()?.items) ? list2.json().items : [];
    const present2 = items2.some((r: any) => String(r?.domain).toLowerCase() === domain.toLowerCase());
    expect(present2).toBe(false);
  });
});
