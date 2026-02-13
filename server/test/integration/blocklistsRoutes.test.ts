import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { extractSessionCookie, hasDocker, startPostgresContainer, startTestApp } from './_harness.js';

type FetchType = typeof fetch;

describe('integration: blocklists routes', () => {
  let dockerOk = false;
  let pg: Awaited<ReturnType<typeof startPostgresContainer>> | null = null;
  let closeApp: (() => Promise<void>) | null = null;
  let app: any;
  let cookie = '';
  let pool: Pool | null = null;
  let baseFetch: FetchType | null = null;

  beforeAll(async () => {
    dockerOk = await hasDocker();
    if (!dockerOk) return;

    pg = await startPostgresContainer();
    pool = new Pool({ connectionString: pg.databaseUrl });

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

    await pool.query('DELETE FROM rules');
    await pool.query('DELETE FROM blocklists');
    await pool.query('DELETE FROM notifications');

    baseFetch = globalThis.fetch;
  }, 120_000);

  afterEach(() => {
    if (baseFetch) globalThis.fetch = baseFetch;
  });

  afterAll(async () => {
    if (baseFetch) globalThis.fetch = baseFetch;
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

  it('CRUD: create/list/update/delete', async () => {
    if (!dockerOk) return;

    const url = 'https://example.invalid/list.txt';

    const created = await app.inject({
      method: 'POST',
      url: '/api/blocklists',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { name: 'Test List', url, enabled: true, mode: 'ACTIVE' }
    });
    expect(created.statusCode).toBe(201);
    const id = created.json()?.id;
    expect(id).toBeTruthy();

    const dup = await app.inject({
      method: 'POST',
      url: '/api/blocklists',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { name: 'Dup', url }
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ error: 'BLOCKLIST_EXISTS' });

    const list = await app.inject({ method: 'GET', url: '/api/blocklists', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(Array.isArray(list.json()?.items)).toBe(true);

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/blocklists/${id}`,
      headers: { cookie, 'content-type': 'application/json' },
      payload: { enabled: false, mode: 'DISABLED' }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()?.enabled).toBe(false);

    const del = await app.inject({ method: 'DELETE', url: `/api/blocklists/${id}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);

    const delMissing = await app.inject({ method: 'DELETE', url: `/api/blocklists/${id}`, headers: { cookie } });
    expect(delMissing.statusCode).toBe(404);
  });

  it('refresh success inserts rules (mocked fetch)', async () => {
    if (!dockerOk || !pool) return;

    const url = 'https://example.invalid/list-refresh.txt';

    const created = await app.inject({
      method: 'POST',
      url: '/api/blocklists',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { name: 'Refresh List', url }
    });
    expect(created.statusCode).toBe(201);
    const id = Number(created.json()?.id);

    globalThis.fetch = (async (input: any, init?: any) => {
      const reqUrl = typeof input === 'string' ? input : typeof input?.url === 'string' ? input.url : '';
      if (reqUrl === url) {
        const body = [
          '# comment',
          '0.0.0.0 ads.example.com',
          '||tracker.example.org^',
          '||localhost^',
          ''
        ].join('\n');
        return new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } });
      }
      return (baseFetch as FetchType)(input, init);
    }) as FetchType;

    const res = await app.inject({ method: 'POST', url: `/api/blocklists/${id}/refresh`, headers: { cookie } });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ ok: true, fetched: 2 });

    const category = `Blocklist:${id}`;
    const rules = await pool.query('SELECT domain, category FROM rules WHERE category = $1 ORDER BY domain ASC', [category]);
    const domains = rules.rows.map((r) => String(r.domain));
    expect(domains).toEqual(['ads.example.com', 'tracker.example.org']);
  });

  it('refresh failure updates last_error and emits a notification (mocked fetch)', async () => {
    if (!dockerOk || !pool) return;

    const url = 'https://example.invalid/list-fail.txt';

    const created = await app.inject({
      method: 'POST',
      url: '/api/blocklists',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { name: 'Fail List', url }
    });
    expect(created.statusCode).toBe(201);
    const id = Number(created.json()?.id);

    globalThis.fetch = (async (input: any, init?: any) => {
      const reqUrl = typeof input === 'string' ? input : typeof input?.url === 'string' ? input.url : '';
      if (reqUrl === url) {
        return new Response('nope', { status: 500 });
      }
      return (baseFetch as FetchType)(input, init);
    }) as FetchType;

    const res = await app.inject({ method: 'POST', url: `/api/blocklists/${id}/refresh`, headers: { cookie } });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'REFRESH_FAILED' });

    const row = await pool.query('SELECT last_error FROM blocklists WHERE id = $1', [id]);
    expect(String(row.rows?.[0]?.last_error ?? '')).toContain('HTTP_500');

    const notif = await pool.query('SELECT entry FROM notifications ORDER BY ts DESC LIMIT 1');
    expect(notif.rowCount).toBe(1);
    expect(notif.rows[0]?.entry?.event).toBe('blocklistRefreshFailed');
  });
});
