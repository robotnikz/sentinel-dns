import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import net from 'node:net';
import dnsPacket from 'dns-packet';

import type { AppConfig } from '../../src/config.js';
import { createDb } from '../../src/db.js';
import { startDnsServer } from '../../src/dns/dnsServer.js';
import { hasDocker, startPostgresContainer } from './_harness.js';

type UdpServer = {
  port: number;
  close: () => Promise<void>;
};

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function pickFreeTcpPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function startStubUpstreamDns(): Promise<UdpServer> {
  const udp = dgram.createSocket('udp4');

  udp.on('message', (msg, rinfo) => {
    try {
      const query: any = dnsPacket.decode(msg);
      const q = query.questions?.[0];
      const name = q?.name ? String(q.name) : 'example.test';

      const resp = dnsPacket.encode({
        type: 'response',
        id: query.id,
        flags: (query.flags ?? 0) | dnsPacket.RECURSION_AVAILABLE,
        questions: query.questions ?? [],
        answers: [{ type: 'A', name, ttl: 60, data: '1.2.3.4' }]
      } as any);

      udp.send(resp, rinfo.port, rinfo.address);
    } catch {
      // ignore
    }
  });

  await new Promise<void>((resolve, reject) => {
    udp.once('error', reject);
    udp.bind(0, '127.0.0.1', () => {
      udp.off('error', reject);
      resolve();
    });
  });

  const addr = udp.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  return {
    port,
    close: async () => {
      await new Promise<void>((resolve) => {
        try {
          udp.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }
  };
}

async function udpQueryFrom(host: string, port: number, name: string, localAddress: string): Promise<any> {
  const msg = dnsPacket.encode({
    type: 'query',
    id: crypto.randomInt(0, 65536),
    flags: dnsPacket.RECURSION_DESIRED,
    questions: [{ type: 'A', name }]
  } as any);

  const socket = dgram.createSocket('udp4');

  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, localAddress, () => {
      socket.off('error', reject);
      resolve();
    });
  });

  return await new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      try {
        socket.close();
      } catch {
        // ignore
      }
      reject(new Error('DNS query timed out'));
    }, 2500);

    socket.once('message', (data) => {
      clearTimeout(t);
      try {
        socket.close();
      } catch {
        // ignore
      }
      try {
        resolve(dnsPacket.decode(data));
      } catch (e) {
        reject(e);
      }
    });

    socket.send(msg, port, host);
  });
}

async function waitForQueryLog(db: any, where: { domain: string; clientIp: string }, timeoutMs = 10_000): Promise<any> {
  const started = Date.now();
  const domain = where.domain;
  const clientIp = where.clientIp;

  while (Date.now() - started < timeoutMs) {
    const res = await db.pool.query(
      `
      SELECT entry
      FROM query_logs
      WHERE entry->>'domain' = $1
        AND entry->>'clientIp' = $2
      ORDER BY ts DESC, id DESC
      LIMIT 1
      `,
      [domain, clientIp]
    );

    const entry = res.rows?.[0]?.entry;
    if (entry) return entry;

    await sleep(250);
  }

  throw new Error(`Timed out waiting for query log for domain=${domain} clientIp=${clientIp}`);
}

describe('integration: subnet policy precedence (Client > Subnet > Global)', () => {
  let dockerOk = false;
  let pg: Awaited<ReturnType<typeof startPostgresContainer>> | null = null;
  let upstream: UdpServer | null = null;
  let dnsClose: (() => Promise<void>) | null = null;
  let db: ReturnType<typeof createDb> | null = null;
  let dnsPort = 0;

  let subnetBlocklistId = '';

  const ipInSubnet = '127.0.0.10';
  const exactClientId = 'exact-1';
  const subnetId = 'subnet-1';

  beforeAll(async () => {
    dockerOk = await hasDocker();
    if (!dockerOk) return;

    pg = await startPostgresContainer();
    upstream = await startStubUpstreamDns();
    dnsPort = await pickFreeTcpPort();

    const config: AppConfig = {
      NODE_ENV: 'test',
      HOST: '0.0.0.0',
      PORT: 0,
      DATA_DIR: process.cwd(),
      DNS_HOST: '127.0.0.1',
      DNS_PORT: dnsPort,
      UPSTREAM_DNS: `127.0.0.1:${upstream.port}`,
      ENABLE_DNS: true,
      SHADOW_RESOLVE_BLOCKED: false,
      FRONTEND_ORIGIN: 'http://localhost',
      ADMIN_TOKEN: '',
      DATABASE_URL: pg.databaseUrl,
      GEMINI_API_KEY: '',
      GEOIP_DB_PATH: 'GeoLite2-City.mmdb',
      SECRETS_KEY: ''
    };

    db = createDb(config);
    await db.init();

    await db.pool.query('DELETE FROM query_logs');
    await db.pool.query('DELETE FROM rules');
    await db.pool.query('DELETE FROM blocklists');
    await db.pool.query('DELETE FROM clients');

    // Create a blocklist that is NOT globally enabled, but is selected by the subnet profile.
    const bl = await db.pool.query(
      "INSERT INTO blocklists(name, url, enabled, mode, updated_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id",
      ['SubnetList', `https://example.test/subnet-${Date.now()}.txt`, false, 'ACTIVE']
    );
    subnetBlocklistId = String(bl.rows?.[0]?.id ?? '');
    if (!subnetBlocklistId) throw new Error('Failed to create blocklist');

    await db.pool.query('INSERT INTO rules(domain, type, category) VALUES ($1, $2, $3)', [
      'subnetblocked.test',
      'BLOCKED',
      `Blocklist:${subnetBlocklistId}:SubnetList`
    ]);

    // Seed subnet policy: custom blocklists.
    await db.pool.query('INSERT INTO clients(id, profile) VALUES ($1, $2)', [
      subnetId,
      {
        id: subnetId,
        name: 'LabSubnet',
        type: 'subnet',
        cidr: '127.0.0.0/24',
        useGlobalSettings: false,
        assignedBlocklists: [subnetBlocklistId],
        useGlobalCategories: true,
        useGlobalApps: true,
        blockedCategories: [],
        blockedApps: [],
        schedules: [],
        isInternetPaused: false
      }
    ]);

    // Seed exact client inside that subnet, using global settings.
    await db.pool.query('INSERT INTO clients(id, profile) VALUES ($1, $2)', [
      exactClientId,
      {
        id: exactClientId,
        name: 'ExactDevice',
        type: 'laptop',
        ip: ipInSubnet,
        useGlobalSettings: true,
        useGlobalCategories: true,
        useGlobalApps: true,
        assignedBlocklists: [],
        blockedCategories: [],
        blockedApps: [],
        schedules: [],
        isInternetPaused: false
      }
    ]);

    // Filtering enabled (no protection pause).
    await db.pool.query(
      "INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
      ['protection_pause', { mode: 'OFF', until: null }]
    );

    const started = await startDnsServer(config, db);
    dnsClose = started.close;
  }, 120_000);

  afterAll(async () => {
    try {
      await dnsClose?.();
    } catch {
      // ignore
    }
    await db?.pool.end().catch(() => undefined);
    await upstream?.close().catch(() => undefined);
    await pg?.stop().catch(() => undefined);
  }, 120_000);

  it('skips if Docker is unavailable', async () => {
    if (!dockerOk) {
      expect(dockerOk).toBe(false);
      return;
    }
    expect(dockerOk).toBe(true);
  });

  it('applies subnet custom blocklists even when an exact client exists (client uses global)', async () => {
    if (!dockerOk || !db) return;

    await db.pool.query('DELETE FROM query_logs');

    const dec: any = await udpQueryFrom('127.0.0.1', dnsPort, 'subnetblocked.test', ipInSubnet);
    expect(String(dec.rcode || '')).toBe('NXDOMAIN');

    const entry = await waitForQueryLog(db, { domain: 'subnetblocked.test', clientIp: ipInSubnet }, 15_000);
    expect(entry.status).toBe('BLOCKED');
    expect(String(entry.blocklistId || '')).toBe(`Blocklist:${subnetBlocklistId}:SubnetList`);
  });

  it('client custom blocklists override subnet selection (client > subnet)', async () => {
    if (!dockerOk || !db) return;

    await db.pool.query('DELETE FROM query_logs');

    // Override: client switches to custom settings but selects no lists -> subnet list should no longer apply.
    await db.pool.query('UPDATE clients SET profile = $2, updated_at = NOW() WHERE id = $1', [
      exactClientId,
      {
        id: exactClientId,
        name: 'ExactDevice',
        type: 'laptop',
        ip: ipInSubnet,
        useGlobalSettings: false,
        assignedBlocklists: [],
        useGlobalCategories: true,
        useGlobalApps: true,
        blockedCategories: [],
        blockedApps: [],
        schedules: [],
        isInternetPaused: false
      }
    ]);

    // DNS server refreshes caches every 5 seconds.
    await sleep(5200);

    const dec: any = await udpQueryFrom('127.0.0.1', dnsPort, 'subnetblocked.test', ipInSubnet);
    expect(String(dec.rcode || 'NOERROR')).toBe('NOERROR');

    const answers = Array.isArray(dec.answers) ? dec.answers : [];
    const a = answers.find((x: any) => x?.type === 'A');
    expect(a?.data).toBe('1.2.3.4');

    const entry = await waitForQueryLog(db, { domain: 'subnetblocked.test', clientIp: ipInSubnet }, 15_000);
    expect(entry.status).toBe('PERMITTED');
  });
});
