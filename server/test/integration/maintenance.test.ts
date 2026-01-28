import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { extractSessionCookie, hasDocker, startPostgresContainer, startTestApp } from './_harness.js';

describe('integration: maintenance endpoints', () => {
  let dockerOk = false;
  let pg: Awaited<ReturnType<typeof startPostgresContainer>> | null = null;
  let closeApp: (() => Promise<void>) | null = null;
  let app: any;
  let pool: Pool | null = null;
  let cookie = '';

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

    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username, password } });
    const setCookie = setup.headers['set-cookie'];
    cookie = extractSessionCookie(setCookie);
    if (!cookie) throw new Error('Missing session cookie from /api/auth/setup');
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

  it('purges query logs older than days', async () => {
    if (!dockerOk) return;
    if (!pool) throw new Error('pool not initialized');

    await pool.query('DELETE FROM query_logs');
    // one old entry and one recent
    await pool.query("INSERT INTO query_logs(ts, entry) VALUES (NOW() - interval '10 days', $1)", [
      { id: 'old', domain: 'old.test', status: 'PERMITTED' }
    ]);
    await pool.query("INSERT INTO query_logs(ts, entry) VALUES (NOW() - interval '1 hours', $1)", [
      { id: 'new', domain: 'new.test', status: 'PERMITTED' }
    ]);

    const purge = await app.inject({
      method: 'POST',
      url: '/api/maintenance/query-logs/purge',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { olderThanDays: 7 }
    });

    expect(purge.statusCode).toBe(200);
    expect(purge.json()).toMatchObject({ ok: true });
    expect(Number(purge.json()?.deleted)).toBeGreaterThanOrEqual(1);

    const count = await pool.query('SELECT COUNT(*)::int AS count FROM query_logs');
    expect(count.rows?.[0]?.count).toBe(1);
  });

  it('clears notifications (read-only) and ignored anomalies (expired)', async () => {
    if (!dockerOk) return;
    if (!pool) throw new Error('pool not initialized');

    await pool.query('DELETE FROM notifications');
    await pool.query('DELETE FROM ignored_anomalies');

    await pool.query('INSERT INTO notifications(read, entry) VALUES (TRUE, $1)', [{ kind: 'test', n: 1 }]);
    await pool.query('INSERT INTO notifications(read, entry) VALUES (FALSE, $1)', [{ kind: 'test', n: 2 }]);

    await pool.query("INSERT INTO ignored_anomalies(signature, ignored_at) VALUES ('x', NOW() - interval '40 days')");
    await pool.query("INSERT INTO ignored_anomalies(signature, ignored_at) VALUES ('y', NOW() - interval '1 days')");

    const clearRead = await app.inject({
      method: 'POST',
      url: '/api/maintenance/notifications/clear',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { mode: 'read' }
    });
    expect(clearRead.statusCode).toBe(200);
    expect(clearRead.json()).toMatchObject({ ok: true });

    const nCount = await pool.query('SELECT COUNT(*)::int AS count FROM notifications');
    expect(nCount.rows?.[0]?.count).toBe(1);

    const purgeExpired = await app.inject({
      method: 'POST',
      url: '/api/maintenance/ignored-anomalies/clear',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { mode: 'expired' }
    });
    expect(purgeExpired.statusCode).toBe(200);
    expect(purgeExpired.json()).toMatchObject({ ok: true });

    const iaCount = await pool.query('SELECT COUNT(*)::int AS count FROM ignored_anomalies');
    expect(iaCount.rows?.[0]?.count).toBe(1);
  });

  it('exports settings bundle and supports dry-run import', async () => {
    if (!dockerOk) return;

    const exp = await app.inject({ method: 'GET', url: '/api/maintenance/export', headers: { cookie } });
    expect(exp.statusCode).toBe(200);
    const body = exp.json();
    expect(body).toHaveProperty('schemaVersion');
    expect(body).toHaveProperty('data');

    const imp = await app.inject({
      method: 'POST',
      url: '/api/maintenance/import',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { dryRun: true, data: { settings: [], rules: [], clients: [], blocklists: [] } }
    });
    expect(imp.statusCode).toBe(200);
    expect(imp.json()).toMatchObject({ ok: true, dryRun: true });
  });
});
