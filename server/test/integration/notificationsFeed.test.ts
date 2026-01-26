import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { extractSessionCookie, hasDocker, startPostgresContainer, startTestApp } from './_harness.js';

describe('integration: notifications feed', () => {
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

  it('lists feed items, counts unread, and marks read (ids + all)', async () => {
    if (!dockerOk || !pool) return;

    await pool.query('DELETE FROM notifications');

    const now = Date.now();
    await pool.query('INSERT INTO notifications(entry) VALUES ($1), ($2), ($3)', [
      { event: 'integration', title: 'N1', message: 'm1', createdAt: new Date(now - 2000).toISOString() },
      { event: 'integration', title: 'N2', message: 'm2', createdAt: new Date(now - 1000).toISOString() },
      { event: 'integration', title: 'N3', message: 'm3', createdAt: new Date(now).toISOString() }
    ]);

    const unread1 = await app.inject({
      method: 'GET',
      url: '/api/notifications/feed/unread-count',
      headers: { cookie }
    });
    expect(unread1.statusCode).toBe(200);
    expect(unread1.json()?.count).toBe(3);

    const feed = await app.inject({
      method: 'GET',
      url: '/api/notifications/feed?limit=2',
      headers: { cookie }
    });
    expect(feed.statusCode).toBe(200);
    const items = Array.isArray(feed.json()?.items) ? feed.json().items : [];
    expect(items.length).toBe(2);
    expect(items[0]).toHaveProperty('id');
    expect(items[0]).toHaveProperty('read', false);

    // Mark just the first returned notification as read.
    const mark = await app.inject({
      method: 'POST',
      url: '/api/notifications/feed/mark-read',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { ids: [items[0].id] }
    });
    expect(mark.statusCode).toBe(200);
    expect(mark.json()).toMatchObject({ ok: true });

    const unread2 = await app.inject({
      method: 'GET',
      url: '/api/notifications/feed/unread-count',
      headers: { cookie }
    });
    expect(unread2.statusCode).toBe(200);
    expect(unread2.json()?.count).toBe(2);

    const markAll = await app.inject({
      method: 'POST',
      url: '/api/notifications/feed/mark-read',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { all: true }
    });
    expect(markAll.statusCode).toBe(200);

    const unread3 = await app.inject({
      method: 'GET',
      url: '/api/notifications/feed/unread-count',
      headers: { cookie }
    });
    expect(unread3.statusCode).toBe(200);
    expect(unread3.json()?.count).toBe(0);
  });

  it('discord test returns 400 when no valid webhook is configured', async () => {
    if (!dockerOk) return;

    const res = await app.inject({
      method: 'POST',
      url: '/api/notifications/discord/test',
      headers: { cookie, 'content-type': 'application/json' },
      payload: {}
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'NO_WEBHOOK' });
  });
});
