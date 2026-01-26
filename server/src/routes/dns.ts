import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';

export type DnsSettings = {
  upstreamMode: 'unbound' | 'forward';
  // If mode=forward: supports plain UDP/TCP, DNS-over-TLS (DoT) and DNS-over-HTTPS (DoH).
  forward: {
    transport: 'udp' | 'tcp' | 'dot' | 'doh';
    host?: string;
    port?: number;
    dohUrl?: string;
  };
};

const DEFAULT_SETTINGS: DnsSettings = {
  upstreamMode: 'unbound',
  forward: { host: '1.1.1.1', port: 53, transport: 'udp' }
};

function normalize(input: any): DnsSettings {
  const s = typeof input === 'object' && input ? input : {};
  const mode = s.upstreamMode === 'forward' ? 'forward' : 'unbound';
  const forward = typeof s.forward === 'object' && s.forward ? s.forward : {};
  const transport =
    forward.transport === 'tcp'
      ? 'tcp'
      : forward.transport === 'dot'
        ? 'dot'
        : forward.transport === 'doh'
          ? 'doh'
          : 'udp';

  const host = typeof forward.host === 'string' && forward.host.trim() ? forward.host.trim() : DEFAULT_SETTINGS.forward.host;
  const portDefault = transport === 'dot' ? 853 : DEFAULT_SETTINGS.forward.port;
  const portRaw = Number(forward.port);
  const port = Number.isFinite(portRaw) && portRaw > 0 ? Math.min(65535, Math.floor(portRaw)) : portDefault;
  const dohUrl = typeof forward.dohUrl === 'string' && forward.dohUrl.trim() ? forward.dohUrl.trim() : undefined;

  if (transport === 'doh') {
    // Use a well-known default if missing.
    return {
      upstreamMode: mode,
      forward: {
        transport,
        dohUrl: dohUrl ?? 'https://cloudflare-dns.com/dns-query'
      }
    };
  }

  return { upstreamMode: mode, forward: { host, port, transport } };
}

export async function registerDnsRoutes(app: FastifyInstance, config: AppConfig, db: Db): Promise<void> {
  app.get(
    '/api/dns/settings',
    {
      onRequest: [app.rateLimit()],
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute'
        }
      }
    },
    async (request) => {
      await requireAdmin(db, request);
      const res = await db.pool.query('SELECT value FROM settings WHERE key = $1', ['dns_settings']);
      const value = res.rows?.[0]?.value;
      return { value: normalize(value) };
    }
  );

  app.put(
    '/api/dns/settings',
    {
      onRequest: [app.rateLimit()],
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute'
        }
      },
      schema: {
        body: {
          type: 'object',
          additionalProperties: true,
          properties: {
            upstreamMode: { type: 'string', enum: ['unbound', 'forward'] },
            forward: {
              type: 'object',
              additionalProperties: true,
              properties: {
                transport: { type: 'string', enum: ['udp', 'tcp', 'dot', 'doh'] },
                host: { type: 'string', minLength: 1, maxLength: 253 },
                port: { type: 'number' },
                dohUrl: { type: 'string', minLength: 8, maxLength: 2048 }
              }
            }
          }
        }
      }
    },
    async (request: FastifyRequest<{ Body: DnsSettings }>, reply: FastifyReply) => {
      await requireAdmin(db, request);

      const normalized = normalize(request.body);

      if (normalized.upstreamMode === 'forward') {
        if (normalized.forward.transport === 'doh') {
          if (!normalized.forward.dohUrl) {
            reply.code(400);
            return { error: 'INVALID_UPSTREAM', message: 'DoH upstream URL required.' };
          }
        } else {
          if (!normalized.forward.host || !normalized.forward.port) {
            reply.code(400);
            return { error: 'INVALID_UPSTREAM', message: 'Forward upstream host/port required.' };
          }
        }
      }

      await db.pool.query(
        'INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
        ['dns_settings', normalized]
      );

      return { ok: true, value: normalized };
    }
  );
}
