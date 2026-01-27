import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { extractSessionCookie, hasDocker, startPostgresContainer, startTestApp } from './_harness.js';

describe('integration: misc routes (clients + dns + query-logs)', () => {
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

  it('clients CRUD + validation (including subnet CIDR)', async () => {
    if (!dockerOk) return;
    if (!pool) throw new Error('pool not initialized');

    await pool.query('DELETE FROM clients');

    const id = `c-${Date.now()}`;

    const mismatch = await app.inject({
      method: 'PUT',
      url: `/api/clients/${id}`,
      headers: { cookie, 'content-type': 'application/json' },
      payload: { id: `${id}-x`, name: 'My client', type: 'laptop' }
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json()).toMatchObject({ error: 'ID_MISMATCH' });

    const missingCidr = await app.inject({
      method: 'PUT',
      url: `/api/clients/${id}`,
      headers: { cookie, 'content-type': 'application/json' },
      payload: { id, name: 'Subnet', type: 'subnet' }
    });
    expect(missingCidr.statusCode).toBe(400);
    expect(missingCidr.json()).toMatchObject({ error: 'INVALID_CIDR' });

    const badCidr = await app.inject({
      method: 'PUT',
      url: `/api/clients/${id}`,
      headers: { cookie, 'content-type': 'application/json' },
      payload: { id, name: 'Subnet', type: 'subnet', cidr: 'not-a-cidr' }
    });
    expect(badCidr.statusCode).toBe(400);
    expect(badCidr.json()).toMatchObject({ error: 'INVALID_CIDR' });

    const ok = await app.inject({
      method: 'PUT',
      url: `/api/clients/${id}`,
      headers: { cookie, 'content-type': 'application/json' },
      payload: { id, name: 'Laptop', type: 'laptop' }
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ id, name: 'Laptop', type: 'laptop' });

    const list = await app.inject({ method: 'GET', url: '/api/clients', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const items = Array.isArray(list.json()?.items) ? list.json().items : [];
    expect(items.some((x: any) => x?.id === id)).toBe(true);

    // Seed scoped rules and ensure they are removed when deleting the client.
    await pool.query('DELETE FROM rules');
    await pool.query('INSERT INTO rules(domain, type, category) VALUES ($1, $2, $3)', [`scoped-${id}.test`, 'BLOCKED', `Client:${id}`]);
    await pool.query('INSERT INTO rules(domain, type, category) VALUES ($1, $2, $3)', [`scoped2-${id}.test`, 'BLOCKED', `Client:${id}:Manual`]);
    await pool.query('INSERT INTO rules(domain, type, category) VALUES ($1, $2, $3)', [`scoped3-${id}.test`, 'BLOCKED', `Subnet:${id}:Manual`]);

    const del = await app.inject({ method: 'DELETE', url: `/api/clients/${id}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);

    const remaining = await pool.query(
      `SELECT COUNT(*)::int AS n FROM rules WHERE category LIKE $1 OR category LIKE $2`,
      [`Client:${id}%`, `Subnet:${id}%`]
    );
    expect(Number(remaining.rows?.[0]?.n ?? 0)).toBe(0);

    const del404 = await app.inject({ method: 'DELETE', url: `/api/clients/${id}`, headers: { cookie } });
    expect(del404.statusCode).toBe(404);
    expect(del404.json()).toMatchObject({ error: 'NOT_FOUND' });

    // Same delete endpoint is used for subnet profiles. Ensure Subnet:<id> scoped rules are cleaned up too.
    await pool.query('DELETE FROM clients');
    await pool.query('DELETE FROM rules');

    const subnetId = `s-${Date.now()}`;
    const okSubnet = await app.inject({
      method: 'PUT',
      url: `/api/clients/${subnetId}`,
      headers: { cookie, 'content-type': 'application/json' },
      payload: { id: subnetId, name: 'Subnet', type: 'subnet', cidr: '10.0.0.0/24' }
    });
    expect(okSubnet.statusCode).toBe(200);

    await pool.query('INSERT INTO rules(domain, type, category) VALUES ($1, $2, $3)', [
      `scoped-${subnetId}.test`,
      'BLOCKED',
      `Subnet:${subnetId}:Manual`
    ]);

    const delSubnet = await app.inject({ method: 'DELETE', url: `/api/clients/${subnetId}`, headers: { cookie } });
    expect(delSubnet.statusCode).toBe(204);

    const remainingSubnet = await pool.query(`SELECT COUNT(*)::int AS n FROM rules WHERE category LIKE $1`, [`Subnet:${subnetId}%`]);
    expect(Number(remainingSubnet.rows?.[0]?.n ?? 0)).toBe(0);
  });

  it('dns settings normalize defaults (udp/tcp/dot/doh)', async () => {
    if (!dockerOk) return;
    if (!pool) throw new Error('pool not initialized');

    await pool.query("DELETE FROM settings WHERE key = 'dns_settings'");

    const get1 = await app.inject({ method: 'GET', url: '/api/dns/settings', headers: { cookie } });
    expect(get1.statusCode).toBe(200);
    expect(get1.json()).toMatchObject({
      value: { upstreamMode: 'unbound', forward: { transport: 'udp', host: '1.1.1.1', port: 53 } }
    });

    const putDot = await app.inject({
      method: 'PUT',
      url: '/api/dns/settings',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { upstreamMode: 'forward', forward: { transport: 'dot', host: '9.9.9.9' } }
    });
    expect(putDot.statusCode).toBe(200);
    expect(putDot.json()).toMatchObject({
      ok: true,
      value: { upstreamMode: 'forward', forward: { transport: 'dot', host: '9.9.9.9', port: 853 } }
    });

    const putClamp = await app.inject({
      method: 'PUT',
      url: '/api/dns/settings',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { upstreamMode: 'forward', forward: { transport: 'tcp', host: '8.8.8.8', port: 999999 } }
    });
    expect(putClamp.statusCode).toBe(200);
    expect(putClamp.json()?.value?.forward?.port).toBe(65535);

    const putDohDefault = await app.inject({
      method: 'PUT',
      url: '/api/dns/settings',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { upstreamMode: 'forward', forward: { transport: 'doh' } }
    });
    expect(putDohDefault.statusCode).toBe(200);
    expect(putDohDefault.json()).toMatchObject({
      ok: true,
      value: { upstreamMode: 'forward', forward: { transport: 'doh', dohUrl: 'https://cloudflare-dns.com/dns-query' } }
    });

    const get2 = await app.inject({ method: 'GET', url: '/api/dns/settings', headers: { cookie } });
    expect(get2.statusCode).toBe(200);
    expect(get2.json()?.value?.forward?.transport).toBe('doh');
  });

  it('query logs ingest + list clamps limit and returns _db metadata', async () => {
    if (!dockerOk) return;
    if (!pool) throw new Error('pool not initialized');

    await pool.query('DELETE FROM query_logs');

    const bad = await app.inject({
      method: 'POST',
      url: '/api/query-logs/ingest',
      headers: { cookie, 'content-type': 'application/json' },
      payload: {}
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'NO_ITEMS' });

    const one = await app.inject({
      method: 'POST',
      url: '/api/query-logs/ingest',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { item: { id: 'q1', domain: 'a.test', status: 'PERMITTED', clientIp: '1.2.3.4' } }
    });
    expect(one.statusCode).toBe(202);
    expect(one.json()).toMatchObject({ ok: true, ingested: 1 });

    const listMin = await app.inject({ method: 'GET', url: '/api/query-logs?limit=0', headers: { cookie } });
    expect(listMin.statusCode).toBe(200);
    const itemsMin = Array.isArray(listMin.json()?.items) ? listMin.json().items : [];
    expect(itemsMin.length).toBe(1);
    expect(itemsMin[0]).toHaveProperty('_db');
    expect(itemsMin[0]?._db).toHaveProperty('id');
    expect(itemsMin[0]?._db).toHaveProperty('ts');

    const many = await app.inject({
      method: 'POST',
      url: '/api/query-logs/ingest',
      headers: { cookie, 'content-type': 'application/json' },
      payload: {
        items: [
          { id: 'q2', domain: 'b.test', status: 'BLOCKED', clientIp: '5.6.7.8' },
          { id: 'q3', domain: 'c.test', status: 'PERMITTED', clientIp: '9.9.9.9' }
        ]
      }
    });
    expect(many.statusCode).toBe(202);
    expect(many.json()).toMatchObject({ ok: true, ingested: 2 });

    const list = await app.inject({ method: 'GET', url: '/api/query-logs?limit=5000', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const items = Array.isArray(list.json()?.items) ? list.json().items : [];
    expect(items.length).toBe(3);

    const flush = await app.inject({ method: 'POST', url: '/api/query-logs/flush', headers: { cookie } });
    expect(flush.statusCode).toBe(200);
    expect(flush.json()).toMatchObject({ ok: true });
    expect(Number(flush.json()?.deleted)).toBeGreaterThanOrEqual(3);

    const listAfter = await app.inject({ method: 'GET', url: '/api/query-logs?limit=500', headers: { cookie } });
    expect(listAfter.statusCode).toBe(200);
    const itemsAfter = Array.isArray(listAfter.json()?.items) ? listAfter.json().items : [];
    expect(itemsAfter.length).toBe(0);
  });
});
