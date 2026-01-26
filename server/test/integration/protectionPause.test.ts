import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { extractSessionCookie, hasDocker, startPostgresContainer, startTestApp } from './_harness.js';

describe('integration: protection pause', () => {
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

    // Do NOT wipe the whole settings table here: it would remove auth/session state created by setup.
    await pool.query("DELETE FROM settings WHERE key IN ('protection_pause', 'notification_events')");
    await pool.query('DELETE FROM notifications');
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

  it('can pause until a duration and resume; validates duration', async () => {
    if (!dockerOk || !pool) return;

    const initial = await app.inject({ method: 'GET', url: '/api/protection/pause', headers: { cookie } });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({ active: false, mode: 'OFF' });

    const bad = await app.inject({
      method: 'PUT',
      url: '/api/protection/pause',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { mode: 'UNTIL' }
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'INVALID_DURATION' });

    const paused = await app.inject({
      method: 'PUT',
      url: '/api/protection/pause',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { mode: 'UNTIL', durationMinutes: 1 }
    });
    expect(paused.statusCode).toBe(200);
    expect(paused.json()?.active).toBe(true);
    expect(paused.json()?.mode).toBe('UNTIL');

    const resumed = await app.inject({
      method: 'PUT',
      url: '/api/protection/pause',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { mode: 'OFF' }
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json()).toMatchObject({ active: false, mode: 'OFF' });

    // Notifications should be persisted (pause + resume).
    const n = await pool.query('SELECT COUNT(*)::int AS c FROM notifications');
    expect(n.rows?.[0]?.c ?? 0).toBeGreaterThanOrEqual(1);
  });
});
