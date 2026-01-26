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

function todayKey(now: Date): string {
  return (['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const)[now.getDay()];
}

describe('integration: DNS policies (client + protection pause)', () => {
  let dockerOk = false;
  let pg: Awaited<ReturnType<typeof startPostgresContainer>> | null = null;
  let upstream: UdpServer | null = null;
  let dnsClose: (() => Promise<void>) | null = null;
  let db: ReturnType<typeof createDb> | null = null;
  let dnsPort = 0;

  const clientPolicyIp = '127.0.0.1';
  const pausedKillSwitchIp = '127.0.0.2';

  beforeAll(async () => {
    dockerOk = await hasDocker();
    if (!dockerOk) return;

    pg = await startPostgresContainer();
    upstream = await startStubUpstreamDns();
    dnsPort = await pickFreeTcpPort();

    const now = new Date();

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

    // Seed a manual block rule. Protection pause should bypass this.
    await db.pool.query('DELETE FROM rules');
    await db.pool.query('INSERT INTO rules(domain, type, category) VALUES ($1, $2, $3)', [
      'blocked.test',
      'BLOCKED',
      'Manual'
    ]);

    // Seed clients BEFORE starting DNS so caches are primed immediately.
    await db.pool.query('DELETE FROM clients');

    const schedule = {
      id: 'sched-1',
      name: 'blockall',
      days: [todayKey(now)],
      startTime: '00:00',
      endTime: '23:59',
      active: true,
      mode: 'custom',
      blockedCategories: [],
      blockedApps: [],
      blockAll: true
    };

    await db.pool.query('INSERT INTO clients(id, profile) VALUES ($1, $2)', [
      'c1',
      {
        id: 'c1',
        name: 'PolicyClient',
        ip: clientPolicyIp,
        isInternetPaused: false,
        useGlobalSettings: true,
        useGlobalCategories: true,
        useGlobalApps: true,
        schedules: [schedule]
      }
    ]);

    await db.pool.query('INSERT INTO clients(id, profile) VALUES ($1, $2)', [
      'c2',
      {
        id: 'c2',
        name: 'KillSwitchClient',
        ip: pausedKillSwitchIp,
        isInternetPaused: true
      }
    ]);

    // Start with protection pause enabled.
    await db.pool.query(
      "INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
      ['protection_pause', { mode: 'FOREVER', until: null }]
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

  it('protection pause bypasses manual block rules', async () => {
    if (!dockerOk || !db) return;

    const dec: any = await udpQueryFrom('127.0.0.1', dnsPort, 'blocked.test', clientPolicyIp);
    expect(String(dec.rcode || 'NOERROR')).toBe('NOERROR');

    const answers = Array.isArray(dec.answers) ? dec.answers : [];
    const a = answers.find((x: any) => x?.type === 'A');
    expect(a?.data).toBe('1.2.3.4');

    const entry = await waitForQueryLog(db, { domain: 'blocked.test', clientIp: clientPolicyIp }, 15_000);
    expect(entry.status).toBe('PERMITTED');
    expect(entry.protectionPaused).toBe(true);
  });

  it('protection pause bypasses schedule blockAll for clients (filtering off)', async () => {
    if (!dockerOk || !db) return;

    const dec: any = await udpQueryFrom('127.0.0.1', dnsPort, 'anything.test', clientPolicyIp);
    expect(String(dec.rcode || 'NOERROR')).toBe('NOERROR');

    const answers = Array.isArray(dec.answers) ? dec.answers : [];
    const a = answers.find((x: any) => x?.type === 'A');
    expect(a?.data).toBe('1.2.3.4');

    const entry = await waitForQueryLog(db, { domain: 'anything.test', clientIp: clientPolicyIp }, 15_000);
    expect(entry.status).toBe('PERMITTED');
    expect(entry.protectionPaused).toBe(true);
  });

  it('client internet paused remains a hard kill-switch even when protection is paused', async () => {
    if (!dockerOk || !db) return;

    const dec: any = await udpQueryFrom('127.0.0.1', dnsPort, 'allowed.test', pausedKillSwitchIp);
    expect(String(dec.rcode || '')).toBe('NXDOMAIN');

    const entry = await waitForQueryLog(db, { domain: 'allowed.test', clientIp: pausedKillSwitchIp }, 15_000);
    expect(entry.status).toBe('BLOCKED');
    expect(String(entry.blocklistId || '')).toBe('ClientPolicy:InternetPaused');
    expect(entry.protectionPaused).not.toBe(true);
  });

  it('when protection pause is turned OFF, schedule blockAll is enforced again', async () => {
    if (!dockerOk || !db) return;

    await db.pool.query(
      "INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
      ['protection_pause', { mode: 'OFF', until: null }]
    );

    // DNS server refreshes protection pause every second.
    await sleep(1200);

    const dec: any = await udpQueryFrom('127.0.0.1', dnsPort, 'postpause.test', clientPolicyIp);
    expect(String(dec.rcode || '')).toBe('NXDOMAIN');

    const entry = await waitForQueryLog(db, { domain: 'postpause.test', clientIp: clientPolicyIp }, 15_000);
    expect(entry.status).toBe('BLOCKED');
    expect(String(entry.blocklistId || '')).toBe('ClientPolicy:BlockAll');
  });
});
