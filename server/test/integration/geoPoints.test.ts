import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { extractSessionCookie, hasDocker, startPostgresContainer, startTestApp } from './_harness.js';

// Mock GeoIP lookup to deterministically cover the "points" aggregation and label logic.
vi.mock('../../src/geoip/geoip.js', async () => {
  const actual: any = await vi.importActual('../../src/geoip/geoip.js');

  return {
    ...actual,
    createGeoIpLookup: async () => {
      return {
        status: { available: true, dbPath: '/tmp/fake.mmdb' },
        lookup: (ip: string) => {
          const trimmed = String(ip ?? '').trim();
          if (trimmed === '8.8.8.8') {
            return {
              source: 'maxmind',
              code: 'US',
              name: 'United States',
              lat: 37.386,
              lon: -122.0838,
              city: 'Mountain View',
              region: 'California'
            };
          }
          if (trimmed === '8.8.4.4') {
            return {
              source: 'maxmind',
              code: 'US',
              name: 'United States',
              // Intentionally close so bucketing rounds to the same 0.1°
              lat: 37.3861,
              lon: -122.0839,
              city: 'Mountain View',
              region: 'CA'
            };
          }
          if (trimmed === '1.1.1.1') {
            // Cover "maxmind but no city" label branch.
            return {
              source: 'maxmind',
              code: 'AU',
              name: 'Australia',
              lat: -33.8688,
              lon: 151.2093
            };
          }

          // Cover unmapped public IP branch (source=unknown).
          return { source: 'unknown', code: 'ZZ', name: 'Unknown' };
        }
      };
    }
  };
});

function mkEntry(partial: any) {
  return {
    ts: new Date().toISOString(),
    status: 'PERMITTED',
    type: 'A',
    domain: 'example.com',
    clientIp: '192.168.1.10',
    answerIps: ['8.8.8.8'],
    ...partial
  };
}

describe('integration: geo points aggregation', () => {
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
    await pool.query('INSERT INTO query_logs(entry) VALUES ($1), ($2), ($3), ($4)', [
      mkEntry({ domain: 'allowed.test', status: 'PERMITTED', answerIps: ['8.8.8.8'] }),
      mkEntry({ domain: 'ads.test', status: 'SHADOW_BLOCKED', answerIps: ['8.8.4.4'] }),
      mkEntry({ domain: 'allowed.test', status: 'PERMITTED', answerIps: ['8.8.4.4'] }),
      // Unmapped public IP -> source=unknown -> "Unmapped IP"
      mkEntry({ domain: 'mystery.test', status: 'PERMITTED', answerIps: ['203.0.113.10'] })
    ]);

    // No-city label branch.
    await pool.query('INSERT INTO query_logs(entry) VALUES ($1)', [
      mkEntry({ domain: 'no-city.test', status: 'PERMITTED', answerIps: ['1.1.1.1'] })
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

  it('GET /api/geo/countries returns point markers with labels and top domains', async () => {
    if (!dockerOk) return;

    const res = await app.inject({
      method: 'GET',
      url: '/api/geo/countries?hours=24&limit=50',
      headers: { cookie }
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();

    expect(json).toHaveProperty('geoip');
    expect(json.geoip).toMatchObject({ available: true });

    const items = Array.isArray(json.items) ? json.items : [];
    const names = items.map((i: any) => String(i.countryName ?? ''));
    expect(names.includes('United States')).toBe(true);
    expect(names.includes('Unmapped IP')).toBe(true);

    const points = Array.isArray(json.points) ? json.points : [];
    expect(points.length).toBeGreaterThan(0);

    // We bucket close points to a single marker; ensure we got a label and both top lists.
    const usPoint = points.find((p: any) => String(p.label || '').includes('Mountain View'));
    expect(usPoint).toBeTruthy();
    expect(usPoint).toHaveProperty('topPermittedDomains');
    expect(usPoint).toHaveProperty('topBlockedDomains');

    const permittedDomains = Array.isArray(usPoint.topPermittedDomains) ? usPoint.topPermittedDomains : [];
    const blockedDomains = Array.isArray(usPoint.topBlockedDomains) ? usPoint.topBlockedDomains : [];
    expect(permittedDomains.some((d: any) => d?.domain === 'allowed.test')).toBe(true);
    expect(blockedDomains.some((d: any) => d?.domain === 'ads.test')).toBe(true);

    // Also cover the "no city label" point branch.
    const emptyLabelPoint = points.find((p: any) => p && typeof p.label === 'string' && p.label === '');
    expect(emptyLabelPoint).toBeTruthy();
  });
});
