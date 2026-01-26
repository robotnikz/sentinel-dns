import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import dgram from 'node:dgram';
import net from 'node:net';
import http from 'node:http';
import dnsPacket from 'dns-packet';

import type { AppConfig } from '../../src/config.js';
import { createDb } from '../../src/db.js';
import { startDnsServer } from '../../src/dns/dnsServer.js';
import { hasDocker, startPostgresContainer } from './_harness.js';

type TcpServer = { port: number; close: () => Promise<void> };

type HttpServer = { url: string; close: () => Promise<void> };

type DnsServerHandle = { port: number; close: () => Promise<void> };

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

async function startStubUpstreamTcp(ip: string): Promise<TcpServer> {
  const server = net.createServer((socket) => {
    socket.setNoDelay(true);

    let buf = Buffer.alloc(0);

    socket.on('data', (data) => {
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
        answers: [{ type: 'A', name, ttl: 60, data: ip }]
      } as any);

      const outLen = Buffer.alloc(2);
      outLen.writeUInt16BE(resp.length, 0);
      socket.write(Buffer.concat([outLen, resp]));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  return {
    port,
    close: async () => {
      await new Promise<void>((resolve) => {
        try {
          server.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }
  };
}

async function startStubDohServer(opts: { status: number; ip: string }): Promise<HttpServer> {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('METHOD_NOT_ALLOWED');
      return;
    }

    const chunks: Buffer[] = [];
    for await (const c of req) {
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    }
    const msg = Buffer.concat(chunks);

    if (opts.status !== 200) {
      res.statusCode = opts.status;
      res.setHeader('content-type', 'text/plain');
      res.end('ERROR');
      return;
    }

    const q: any = dnsPacket.decode(msg);
    const question = q.questions?.[0];
    const name = question?.name ? String(question.name) : 'example.test';

    const resp = dnsPacket.encode({
      type: 'response',
      id: q.id,
      flags: (q.flags ?? 0) | dnsPacket.RECURSION_AVAILABLE,
      questions: q.questions ?? [],
      answers: [{ type: 'A', name, ttl: 60, data: opts.ip }]
    } as any);

    res.statusCode = 200;
    res.setHeader('content-type', 'application/dns-message');
    res.end(resp);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  return {
    url: `http://127.0.0.1:${port}/dns-query`,
    close: async () => {
      await new Promise<void>((resolve) => {
        try {
          server.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }
  };
}

async function startDnsWithSettings(params: {
  databaseUrl: string;
  dnsPort: number;
  dnsSettingsValue: any;
}): Promise<DnsServerHandle> {
  const config: AppConfig = {
    NODE_ENV: 'test',
    HOST: '0.0.0.0',
    PORT: 0,
    DATA_DIR: process.cwd(),
    DNS_HOST: '127.0.0.1',
    DNS_PORT: params.dnsPort,
    // not used in forward mode, but required by config shape
    UPSTREAM_DNS: '127.0.0.1:53',
    ENABLE_DNS: true,
    SHADOW_RESOLVE_BLOCKED: false,
    FRONTEND_ORIGIN: 'http://localhost',
    ADMIN_TOKEN: '',
    DATABASE_URL: params.databaseUrl,
    GEMINI_API_KEY: '',
    GEOIP_DB_PATH: 'GeoLite2-City.mmdb',
    SECRETS_KEY: ''
  };

  const db = createDb(config);
  await db.init();

  await db.pool.query('DELETE FROM rules');
  await db.pool.query("DELETE FROM settings WHERE key = 'dns_settings'");
  await db.pool.query('INSERT INTO settings(key, value) VALUES ($1, $2)', ['dns_settings', params.dnsSettingsValue]);

  const started = await startDnsServer(config, db);

  return {
    port: params.dnsPort,
    close: async () => {
      await started.close();
      await db.pool.end().catch(() => undefined);
    }
  };
}

describe('integration: DNS upstream transports (tcp + doh)', () => {
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

  it('forwards via upstream TCP when configured in dns_settings', async () => {
    if (!dockerOk || !pg) return;

    const upstream = await startStubUpstreamTcp('9.8.7.6');
    const dnsPort = await pickFreeTcpPort();

    const dns = await startDnsWithSettings({
      databaseUrl: pg.databaseUrl,
      dnsPort,
      dnsSettingsValue: { upstreamMode: 'forward', forward: { transport: 'tcp', host: '127.0.0.1', port: upstream.port } }
    });

    try {
      const dec: any = await udpQuery('127.0.0.1', dns.port, 'tcp-upstream.test');
      expect(String(dec.rcode || 'NOERROR')).toBe('NOERROR');

      const answers = Array.isArray(dec.answers) ? dec.answers : [];
      const a = answers.find((x: any) => x?.type === 'A');
      expect(a?.data).toBe('9.8.7.6');
    } finally {
      await dns.close().catch(() => undefined);
      await upstream.close().catch(() => undefined);
    }
  });

  it('forwards via upstream DoH when configured in dns_settings', async () => {
    if (!dockerOk || !pg) return;

    const doh = await startStubDohServer({ status: 200, ip: '6.6.6.6' });
    const dnsPort = await pickFreeTcpPort();

    const dns = await startDnsWithSettings({
      databaseUrl: pg.databaseUrl,
      dnsPort,
      dnsSettingsValue: { upstreamMode: 'forward', forward: { transport: 'doh', dohUrl: doh.url } }
    });

    try {
      const dec: any = await udpQuery('127.0.0.1', dns.port, 'doh-upstream.test');
      expect(String(dec.rcode || 'NOERROR')).toBe('NOERROR');

      const answers = Array.isArray(dec.answers) ? dec.answers : [];
      const a = answers.find((x: any) => x?.type === 'A');
      expect(a?.data).toBe('6.6.6.6');
    } finally {
      await dns.close().catch(() => undefined);
      await doh.close().catch(() => undefined);
    }
  });

  it('returns SERVFAIL when DoH upstream returns non-OK HTTP', async () => {
    if (!dockerOk || !pg) return;

    const doh = await startStubDohServer({ status: 500, ip: '6.6.6.6' });
    const dnsPort = await pickFreeTcpPort();

    const dns = await startDnsWithSettings({
      databaseUrl: pg.databaseUrl,
      dnsPort,
      dnsSettingsValue: { upstreamMode: 'forward', forward: { transport: 'doh', dohUrl: doh.url } }
    });

    try {
      const dec: any = await udpQuery('127.0.0.1', dns.port, 'doh-fail.test');
      expect(String(dec.rcode || '')).toBe('SERVFAIL');
    } finally {
      await dns.close().catch(() => undefined);
      await doh.close().catch(() => undefined);
    }
  });
});
