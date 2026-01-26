import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { extractSessionCookie, hasDocker, startPostgresContainer, startTestApp } from './_harness.js';

function mkEntry(partial: any) {
  return {
    ts: new Date().toISOString(),
    status: 'PERMITTED',
    type: 'A',
    domain: 'example.com',
    clientIp: '192.168.1.10',
    answerIps: ['1.1.1.1'],
    ...partial
  };
}

describe('integration: metrics + geo routes', () => {
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

    await pool.query('DELETE FROM query_logs');

    // Seed deterministic query logs for metrics aggregation.
    await pool.query('INSERT INTO query_logs(entry) VALUES ($1), ($2), ($3), ($4)', [
      mkEntry({ domain: 'allowed.test', status: 'PERMITTED', clientIp: '192.168.1.10' }),
      mkEntry({ domain: 'ads.test', status: 'BLOCKED', clientIp: '192.168.1.10' }),
      mkEntry({ domain: 'allowed.test', status: 'PERMITTED', clientIp: '192.168.1.11' }),
      // Geo: blocked with no answers
      mkEntry({ domain: 'blocked-noip.test', status: 'BLOCKED', answerIps: [], type: 'A' })
    ]);

    // Geo: successful lookup with no IP answers but non-A type
    await pool.query('INSERT INTO query_logs(entry) VALUES ($1)', [
      mkEntry({ domain: 'https-record.test', status: 'PERMITTED', answerIps: [], type: 'HTTPS' })
    ]);
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

  it('GET /api/metrics/summary aggregates totals', async () => {
    if (!dockerOk) return;

    const res = await app.inject({ method: 'GET', url: '/api/metrics/summary?hours=24', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toMatchObject({ windowHours: 24 });
    expect(json.totalQueries).toBeGreaterThanOrEqual(4);
    expect(json.blockedQueries).toBeGreaterThanOrEqual(1);
    expect(json.activeClients).toBeGreaterThanOrEqual(2);
  });

  it('GET /api/metrics/top-domains and top-blocked return ranked items', async () => {
    if (!dockerOk) return;

    const top = await app.inject({ method: 'GET', url: '/api/metrics/top-domains?hours=24&limit=10', headers: { cookie } });
    expect(top.statusCode).toBe(200);
    const topItems = Array.isArray(top.json()?.items) ? top.json().items : [];
    expect(topItems.length).toBeGreaterThan(0);

    const blocked = await app.inject({ method: 'GET', url: '/api/metrics/top-blocked?hours=24&limit=10', headers: { cookie } });
    expect(blocked.statusCode).toBe(200);
    const blockedItems = Array.isArray(blocked.json()?.items) ? blocked.json().items : [];
    expect(blockedItems.some((r: any) => r.domain === 'ads.test')).toBe(true);
  });

  it('GET /api/metrics/top-domains can exclude configured upstream domains', async () => {
    if (!dockerOk) return;

    // Pretend our upstream resolver is "allowed.test".
    await pool?.query(
      `INSERT INTO settings(key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [
        'dns_settings',
        {
          upstreamMode: 'forward',
          forward: {
            transport: 'udp',
            host: 'allowed.test',
            port: 53
          }
        }
      ]
    );

    const top = await app.inject({
      method: 'GET',
      url: '/api/metrics/top-domains?hours=24&limit=10&excludeUpstreams=1',
      headers: { cookie }
    });
    expect(top.statusCode).toBe(200);

    const topItems = Array.isArray(top.json()?.items) ? top.json().items : [];
    expect(topItems.length).toBeGreaterThan(0);
    expect(topItems.some((r: any) => r.domain === 'allowed.test')).toBe(false);
  });

  it('GET /api/metrics/clients and client-detail return expected shapes', async () => {
    if (!dockerOk) return;

    const clients = await app.inject({ method: 'GET', url: '/api/metrics/clients?hours=24&limit=50', headers: { cookie } });
    expect(clients.statusCode).toBe(200);
    const items = Array.isArray(clients.json()?.items) ? clients.json().items : [];
    expect(items.length).toBeGreaterThanOrEqual(2);

    const missing = await app.inject({ method: 'GET', url: '/api/metrics/client-detail?hours=24', headers: { cookie } });
    expect(missing.statusCode).toBe(200);
    expect(missing.json()).toMatchObject({ error: 'MISSING_CLIENT' });

    const detail = await app.inject({
      method: 'GET',
      url: '/api/metrics/client-detail?hours=24&client=192.168.1.10&limit=10',
      headers: { cookie }
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toHaveProperty('topAllowed');
    expect(detail.json()).toHaveProperty('topBlocked');
  });

  it('GET /api/metrics/timeseries returns window-appropriate buckets', async () => {
    if (!dockerOk) return;

    const res = await app.inject({ method: 'GET', url: '/api/metrics/timeseries?hours=1', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const items = Array.isArray(res.json()?.items) ? res.json().items : [];
    // 1h uses 5-minute buckets -> should be notably more than a handful.
    expect(items.length).toBeGreaterThanOrEqual(10);
    expect(items[0]).toHaveProperty('ts');
    expect(items[0]).toHaveProperty('queries');
    expect(items[0]).toHaveProperty('ads');

    // Ensure bucket step is 5 minutes (best-effort: only if we have at least 2 points).
    if (items.length >= 2) {
      const a = Date.parse(items[0].ts);
      const b = Date.parse(items[1].ts);
      expect(Number.isFinite(a)).toBe(true);
      expect(Number.isFinite(b)).toBe(true);
      expect(b - a).toBe(5 * 60 * 1000);
    }
  });

  it('GET /api/geo/countries classifies missing IPs and GeoIP-not-configured', async () => {
    if (!dockerOk) return;

    const res = await app.inject({ method: 'GET', url: '/api/geo/countries?hours=24&limit=50', headers: { cookie } });
    expect(res.statusCode).toBe(200);

    const json = res.json();
    expect(json).toHaveProperty('items');
    const items = Array.isArray(json.items) ? json.items : [];

    const names = items.map((i: any) => String(i.countryName ?? ''));
    expect(names.some((n) => n.includes('Blocked (no IP answers)'))).toBe(true);
    expect(names.some((n) => n.includes('No IP answers'))).toBe(true);
    // If no GeoIP City DB is configured, public IPs will be grouped under this reason.
    expect(names.some((n) => n.includes('GeoIP not configured'))).toBe(true);
  });
});
