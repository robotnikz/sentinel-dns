import { describe, expect, it, vi } from 'vitest';

import { notifyEvent } from '../../src/notifications/notify.js';

type QueryResult = { rows?: any[]; rowCount?: number };

describe('integration: notifications/notify module (no WAN)', () => {
  it('returns ok:false when event is disabled in settings', async () => {
    const db = {
      pool: {
        query: async (sql: string, params: unknown[]): Promise<QueryResult> => {
          if (sql.startsWith('SELECT value FROM settings')) {
            const key = String(params[0]);
            if (key === 'notification_events') {
              return { rows: [{ value: { protectionPause: false } }], rowCount: 1 };
            }
            return { rows: [{ value: '' }], rowCount: 1 };
          }
          if (sql.startsWith('INSERT INTO notifications')) {
            throw new Error('should not insert when disabled');
          }
          return { rows: [], rowCount: 0 };
        }
      }
    } as any;

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const res = await notifyEvent(db, {} as any, 'protectionPause', { title: 't', message: 'm' });
    expect(res).toEqual({ ok: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('persists to notifications table even when webhook is missing/invalid', async () => {
    const inserts: any[] = [];

    const db = {
      pool: {
        query: async (sql: string, params: unknown[]): Promise<QueryResult> => {
          if (sql.startsWith('SELECT value FROM settings')) {
            const key = String(params[0]);
            if (key === 'notification_events') return { rows: [{ value: {} }], rowCount: 1 };
            if (key === 'discord_webhook') return { rows: [{ value: 'http://not-discord' }], rowCount: 1 };
            return { rows: [{ value: '' }], rowCount: 1 };
          }
          if (sql.startsWith('INSERT INTO notifications')) {
            inserts.push(params[0]);
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }
      }
    } as any;

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const res = await notifyEvent(db, {} as any, 'geoIpUpdated', {
      title: 'GeoIP updated',
      message: 'ok',
      severity: 'info'
    });

    expect(res.ok).toBe(true);
    expect(res.discord?.sent).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();

    expect(inserts.length).toBe(1);
    expect(inserts[0].event).toBe('geoIpUpdated');
    expect(inserts[0].channels.discord.sent).toBe(false);
  });

  it('sends discord webhook when valid url configured and returns sent:true', async () => {
    const inserts: any[] = [];

    const db = {
      pool: {
        query: async (sql: string, params: unknown[]): Promise<QueryResult> => {
          if (sql.startsWith('SELECT value FROM settings')) {
            const key = String(params[0]);
            if (key === 'notification_events') return { rows: [{ value: {} }], rowCount: 1 };
            if (key === 'discord_webhook') {
              return { rows: [{ value: 'https://discord.com/api/webhooks/123/abc' }], rowCount: 1 };
            }
            return { rows: [{ value: '' }], rowCount: 1 };
          }
          if (sql.startsWith('INSERT INTO notifications')) {
            inserts.push(params[0]);
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }
      }
    } as any;

    const fetchSpy = vi.fn(async () => ({ ok: true, status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);

    const res = await notifyEvent(db, {} as any, 'anomalyDetected', {
      title: 'Anomaly',
      message: 'Something happened',
      severity: 'warning'
    });

    expect(res.ok).toBe(true);
    expect(res.discord?.sent).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    expect(inserts.length).toBe(1);
    expect(inserts[0].channels.discord.sent).toBe(true);
  });

  it('surfaces webhook errors as sent:false with error message', async () => {
    const db = {
      pool: {
        query: async (sql: string, params: unknown[]): Promise<QueryResult> => {
          if (sql.startsWith('SELECT value FROM settings')) {
            const key = String(params[0]);
            if (key === 'notification_events') return { rows: [{ value: {} }], rowCount: 1 };
            if (key === 'discord_webhook') {
              return { rows: [{ value: 'https://discord.com/api/webhooks/123/abc' }], rowCount: 1 };
            }
            return { rows: [{ value: '' }], rowCount: 1 };
          }
          if (sql.startsWith('INSERT INTO notifications')) {
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }
      }
    } as any;

    const fetchSpy = vi.fn(async () => ({ ok: false, status: 500 }));
    vi.stubGlobal('fetch', fetchSpy);

    const res = await notifyEvent(db, {} as any, 'blocklistRefreshFailed', {
      title: 'Refresh failed',
      message: 'x',
      severity: 'error'
    });

    expect(res.ok).toBe(true);
    expect(res.discord?.sent).toBe(false);
    expect(String(res.discord?.error || '')).toMatch(/500/);
  });
});
