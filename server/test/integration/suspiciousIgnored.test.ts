import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { extractSessionCookie, hasDocker, startPostgresContainer, startTestApp } from './_harness.js';

describe('integration: suspicious ignored signatures', () => {
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
    const password = `it-pass-${crypto.randomBytes(8).toString('hex')}-12345678`;

    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username, password }
    });

    cookie = extractSessionCookie(setup.headers['set-cookie']);
    if (!cookie) throw new Error('Missing session cookie from /api/auth/setup');

    await pool.query('DELETE FROM ignored_anomalies');
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

  it('PUT then GET returns the ignored signature', async () => {
    if (!dockerOk) return;

    const signature = 'DeviceA|Test Issue';

    const put = await app.inject({
      method: 'PUT',
      url: '/api/suspicious/ignored',
      headers: { cookie },
      payload: { signature }
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ ok: true });

    const get = await app.inject({ method: 'GET', url: '/api/suspicious/ignored', headers: { cookie } });
    expect(get.statusCode).toBe(200);

    const items = Array.isArray(get.json()?.items) ? get.json().items : [];
    expect(items.some((it: any) => it.signature === signature)).toBe(true);
  });

  it('DELETE removes an ignored signature', async () => {
    if (!dockerOk) return;

    const signature = 'DeviceB|Test Issue';

    await app.inject({
      method: 'PUT',
      url: '/api/suspicious/ignored',
      headers: { cookie },
      payload: { signature }
    });

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/suspicious/ignored?signature=${encodeURIComponent(signature)}`,
      headers: { cookie }
    });
    expect(del.statusCode).toBe(204);

    const get = await app.inject({ method: 'GET', url: '/api/suspicious/ignored', headers: { cookie } });
    const items = Array.isArray(get.json()?.items) ? get.json().items : [];
    expect(items.some((it: any) => it.signature === signature)).toBe(false);
  });

  it('GET purges signatures older than 30 days', async () => {
    if (!dockerOk) return;

    const oldSig = 'OldDevice|Old Issue';
    const freshSig = 'FreshDevice|Fresh Issue';

    await pool?.query('DELETE FROM ignored_anomalies');
    await pool?.query(
      "INSERT INTO ignored_anomalies(signature, ignored_at) VALUES ($1, NOW() - interval '31 days'), ($2, NOW())",
      [oldSig, freshSig]
    );

    const get = await app.inject({ method: 'GET', url: '/api/suspicious/ignored', headers: { cookie } });
    expect(get.statusCode).toBe(200);

    const items = Array.isArray(get.json()?.items) ? get.json().items : [];
    expect(items.some((it: any) => it.signature === oldSig)).toBe(false);
    expect(items.some((it: any) => it.signature === freshSig)).toBe(true);

    const dbCheck = await pool?.query('SELECT signature FROM ignored_anomalies ORDER BY signature');
    const sigs = (dbCheck?.rows ?? []).map((r: any) => String(r.signature));
    expect(sigs.includes(oldSig)).toBe(false);
    expect(sigs.includes(freshSig)).toBe(true);
  });
});
