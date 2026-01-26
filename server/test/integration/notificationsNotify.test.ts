import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db.js';
import { notifyEvent } from '../../src/notifications/notify.js';
import { hasDocker, startPostgresContainer } from './_harness.js';

describe('integration: notifyEvent', () => {
  let dockerOk = false;
  let pg: Awaited<ReturnType<typeof startPostgresContainer>> | null = null;
  let db: ReturnType<typeof createDb> | null = null;

  beforeAll(async () => {
    dockerOk = await hasDocker();
    if (!dockerOk) return;

    pg = await startPostgresContainer();
    db = createDb({ DATABASE_URL: pg.databaseUrl } as any);
    await db.init();
  }, 120_000);

  afterAll(async () => {
    await db?.pool.end().catch(() => undefined);
    await pg?.stop().catch(() => undefined);
  }, 120_000);

  it('skips if Docker is unavailable', async () => {
    if (!dockerOk) {
      expect(dockerOk).toBe(false);
      return;
    }
    expect(dockerOk).toBe(true);
  });

  it('persists a bell feed entry even without a Discord webhook', async () => {
    if (!dockerOk || !db) return;

    await db.pool.query('DELETE FROM notifications');
    await db.pool.query('DELETE FROM settings');

    const res = await notifyEvent(
      db,
      {} as any,
      'protectionPause',
      {
        title: 'Protection paused',
        message: 'Protection is paused until resumed.',
        severity: 'warning',
        meta: { mode: 'FOREVER' }
      }
    );

    expect(res.ok).toBe(true);
    expect(res.discord?.sent).toBe(false);

    const rows = await db.pool.query('SELECT entry FROM notifications ORDER BY ts DESC LIMIT 1');
    expect(rows.rows).toHaveLength(1);

    const entry = rows.rows[0]?.entry as any;
    expect(entry).toMatchObject({
      event: 'protectionPause',
      title: 'Protection paused',
      severity: 'warning'
    });
    expect(entry.channels?.discord?.sent).toBe(false);
    expect(entry.meta).toEqual({ mode: 'FOREVER' });
  });

  it('does not persist when the event is disabled via notification_events', async () => {
    if (!dockerOk || !db) return;

    await db.pool.query('DELETE FROM notifications');
    await db.pool.query('DELETE FROM settings');

    await db.pool.query(
      'INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
      ['notification_events', { protectionPause: false }]
    );

    const res = await notifyEvent(db, {} as any, 'protectionPause', {
      title: 'Protection paused',
      message: 'Paused.',
      severity: 'warning'
    });

    expect(res.ok).toBe(false);

    const rows = await db.pool.query('SELECT COUNT(*)::int AS c FROM notifications');
    expect(rows.rows?.[0]?.c ?? 0).toBe(0);
  });
});
