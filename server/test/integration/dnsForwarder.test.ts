import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

async function udpQuery(host: string, port: number, name: string): Promise<any> {
  const msg = dnsPacket.encode({
    type: 'query',
    id: Math.floor(Math.random() * 65535),
    flags: dnsPacket.RECURSION_DESIRED,
    questions: [{ type: 'A', name }]
  } as any);

  const socket = dgram.createSocket('udp4');

  return await new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      try {
        socket.close();
      } catch {
        // ignore
      }
      reject(new Error('DNS query timed out'));
    }, 2000);

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

async function tcpQuery(host: string, port: number, name: string): Promise<any> {
  const payload = dnsPacket.encode({
    type: 'query',
    id: Math.floor(Math.random() * 65535),
    flags: dnsPacket.RECURSION_DESIRED,
    questions: [{ type: 'A', name }]
  } as any);

  const outLen = Buffer.alloc(2);
  outLen.writeUInt16BE(payload.length, 0);

  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setNoDelay(true);

    const t = setTimeout(() => {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      reject(new Error('TCP DNS query timed out'));
    }, 2500);

    let buf = Buffer.alloc(0);

    socket.once('error', (e) => {
      clearTimeout(t);
      reject(e);
    });

    socket.on('data', (data) => {
      buf = Buffer.concat([buf, data]);
      if (buf.length < 2) return;
      const len = buf.readUInt16BE(0);
      if (buf.length < 2 + len) return;
      const msg = buf.subarray(2, 2 + len);
      clearTimeout(t);
      try {
        socket.end();
      } catch {
        // ignore
      }
      try {
        resolve(dnsPacket.decode(msg));
      } catch (e) {
        reject(e);
      }
    });

    socket.once('connect', () => {
      socket.write(Buffer.concat([outLen, payload]));
    });
  });
}

describe('integration: DNS resolver + forwarder', () => {
  let dockerOk = false;
  let pg: Awaited<ReturnType<typeof startPostgresContainer>> | null = null;
  let upstream: UdpServer | null = null;
  let dnsClose: (() => Promise<void>) | null = null;
  let db: ReturnType<typeof createDb> | null = null;
  let dnsPort = 0;

  beforeAll(async () => {
    dockerOk = await hasDocker();
    if (!dockerOk) return;

    pg = await startPostgresContainer();

    // Local stub upstream to make the test deterministic and independent of internet.
    upstream = await startStubUpstreamDns();

    // Find a port that should be available for both UDP+TCP.
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

    // Seed a manual block rule BEFORE starting the DNS server so it gets indexed immediately.
    await db.pool.query('DELETE FROM rules');
    await db.pool.query('INSERT INTO rules(domain, type, category) VALUES ($1, $2, $3)', [
      'blocked.test',
      'BLOCKED',
      'Manual'
    ]);

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

  it('forwards allowed domains to upstream', async () => {
    if (!dockerOk) return;

    const dec: any = await udpQuery('127.0.0.1', dnsPort, 'allowed.test');
    expect(String(dec.rcode || 'NOERROR')).toBe('NOERROR');

    const answers = Array.isArray(dec.answers) ? dec.answers : [];
    const a = answers.find((x: any) => x?.type === 'A');
    expect(a?.data).toBe('1.2.3.4');
  });

  it('returns NXDOMAIN for blocked domains (does not leak upstream answers)', async () => {
    if (!dockerOk) return;

    const dec: any = await udpQuery('127.0.0.1', dnsPort, 'blocked.test');
    expect(String(dec.rcode || '')).toBe('NXDOMAIN');

    const answers = Array.isArray(dec.answers) ? dec.answers : [];
    expect(answers.length).toBe(0);
  });

  it('supports DNS over TCP (forwarding allowed domains)', async () => {
    if (!dockerOk) return;

    const dec: any = await tcpQuery('127.0.0.1', dnsPort, 'allowed-tcp.test');
    expect(String(dec.rcode || 'NOERROR')).toBe('NOERROR');

    const answers = Array.isArray(dec.answers) ? dec.answers : [];
    const a = answers.find((x: any) => x?.type === 'A');
    expect(a?.data).toBe('1.2.3.4');
  });
});
