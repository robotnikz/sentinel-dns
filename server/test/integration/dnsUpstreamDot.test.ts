import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import dgram from 'node:dgram';
import net from 'node:net';
import dnsPacket from 'dns-packet';

import type { AppConfig } from '../../src/config.js';
import { createDb } from '../../src/db.js';
import { hasDocker, startPostgresContainer } from './_harness.js';

// Mock tls.connect so we can deterministically test DoT forwarding without
// having to stand up a real TLS endpoint with trusted certs.
vi.mock('node:tls', async () => {
  const actual: any = await vi.importActual('node:tls');

  const connect = () => {
    const sock: any = new EventEmitter();

    let buf = Buffer.alloc(0);

    sock.write = (data: Buffer) => {
      buf = Buffer.concat([buf, data]);
      if (buf.length < 2) return;
      const len = buf.readUInt16BE(0);
      if (buf.length < 2 + len) return;
      const msg = buf.subarray(2, 2 + len);
      buf = buf.subarray(2 + len);

      const q: any = dnsPacket.decode(msg);
      const question = q.questions?.[0];
      const name = question?.name ? String(question.name) : 'example.test';

      const resp = dnsPacket.encode({
        type: 'response',
        id: q.id,
        flags: (q.flags ?? 0) | dnsPacket.RECURSION_AVAILABLE,
        questions: q.questions ?? [],
        answers: [{ type: 'A', name, ttl: 60, data: '5.5.5.5' }]
      } as any);

      const outLen = Buffer.alloc(2);
      outLen.writeUInt16BE(resp.length, 0);
      process.nextTick(() => sock.emit('data', Buffer.concat([outLen, resp])));
    };

    sock.end = () => {
      process.nextTick(() => sock.emit('end'));
    };

    sock.destroy = () => {
      process.nextTick(() => sock.emit('close'));
    };

    // Trigger secureConnect asynchronously.
    process.nextTick(() => sock.emit('secureConnect'));

    return sock;
  };

  return {
    ...actual,
    connect,
    default: { ...(actual.default ?? actual), connect }
  };
});

// Import AFTER tls mock.
const { startDnsServer } = await import('../../src/dns/dnsServer.js');

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

describe('integration: DNS upstream DoT (mocked tls)', () => {
  let dockerOk = false;
  let pg: Awaited<ReturnType<typeof startPostgresContainer>> | null = null;

  beforeAll(async () => {
    dockerOk = await hasDocker();
    if (!dockerOk) return;
    pg = await startPostgresContainer();
  }, 120_000);

  afterAll(async () => {
    await pg?.stop().catch(() => undefined);
  }, 120_000);

  it('skips if Docker is unavailable', async () => {
    if (!dockerOk) {
      expect(dockerOk).toBe(false);
      return;
    }
    expect(dockerOk).toBe(true);
  });

  it('forwards via upstream DoT when configured in dns_settings', async () => {
    if (!dockerOk || !pg) return;

    const dnsPort = await pickFreeTcpPort();

    const config: AppConfig = {
      NODE_ENV: 'test',
      HOST: '0.0.0.0',
      PORT: 0,
      DATA_DIR: process.cwd(),
      DNS_HOST: '127.0.0.1',
      DNS_PORT: dnsPort,
      UPSTREAM_DNS: '127.0.0.1:53',
      ENABLE_DNS: true,
      SHADOW_RESOLVE_BLOCKED: false,
      FRONTEND_ORIGIN: 'http://localhost',
      ADMIN_TOKEN: '',
      DATABASE_URL: pg.databaseUrl,
      GEMINI_API_KEY: '',
      GEOIP_DB_PATH: 'GeoLite2-City.mmdb',
      SECRETS_KEY: ''
    };

    const db = createDb(config);
    await db.init();

    await db.pool.query('DELETE FROM rules');
    await db.pool.query("DELETE FROM settings WHERE key = 'dns_settings'");
    await db.pool.query('INSERT INTO settings(key, value) VALUES ($1, $2)', [
      'dns_settings',
      { upstreamMode: 'forward', forward: { transport: 'dot', host: 'cloud.example', port: 853 } }
    ]);

    const started = await startDnsServer(config, db);

    try {
      const dec: any = await udpQuery('127.0.0.1', dnsPort, 'dot-upstream.test');
      expect(String(dec.rcode || 'NOERROR')).toBe('NOERROR');

      const answers = Array.isArray(dec.answers) ? dec.answers : [];
      const a = answers.find((x: any) => x?.type === 'A');
      expect(a?.data).toBe('5.5.5.5');
    } finally {
      await started.close().catch(() => undefined);
      await db.pool.end().catch(() => undefined);
    }
  });
});
