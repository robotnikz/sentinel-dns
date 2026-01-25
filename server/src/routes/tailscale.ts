import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { getSecret, hasSecret } from '../secretsStore.js';

const execFileAsync = promisify(execFile);

const TS_SOCKET = '/var/run/tailscale/tailscaled.sock';

async function runTailscale(
  args: string[],
  opts?: { timeoutMs?: number }
): Promise<{ ok: boolean; stdout: string; stderr: string; code?: number }> {
  try {
    const res = await execFileAsync('tailscale', args, {
      env: { ...process.env, TS_SOCKET },
      timeout: opts?.timeoutMs ?? 30_000,
      maxBuffer: 1024 * 1024
    });
    return { ok: true, stdout: String(res.stdout ?? ''), stderr: String(res.stderr ?? '') };
  } catch (e: any) {
    return {
      ok: false,
      stdout: String(e?.stdout ?? ''),
      stderr: String(e?.stderr ?? e?.message ?? ''),
      code: typeof e?.code === 'number' ? e.code : undefined
    };
  }
}

function parseJsonOrNull(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractAuthUrl(text: string): string {
  const combined = String(text ?? '');
  const m = combined.match(/https:\/\/login\.tailscale\.com\/[\w\-./?=&#%]+/i);
  return m?.[0] ?? '';
}

type TailscaleUpBody = {
  authKey?: string;
  hostname?: string;
  advertiseExitNode?: boolean;
  advertiseRoutes?: string[];
  snatSubnetRoutes?: boolean;
  acceptDns?: boolean;
};

type TailscaleConfigBody = {
  hostname?: string;
  advertiseExitNode?: boolean;
  advertiseRoutes?: string[];
  snatSubnetRoutes?: boolean;
  acceptDns?: boolean;
};

type TailscaleAuthUrlResponse =
  | { ok: true; authUrl: string }
  | { ok: false; error: string; message: string; details?: string };

export async function registerTailscaleRoutes(app: FastifyInstance, config: AppConfig, db: Db): Promise<void> {
  app.post('/api/tailscale/auth-url', async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAdmin(db, request);

    // Use `tailscale login` rather than `tailscale up --force-reauth` so we can return
    // quickly with a login URL instead of blocking the request until auth completes.
    const res = await runTailscale(['login', '--accept-dns=false', '--timeout=5s'], { timeoutMs: 10_000 });
    const combined = `${res.stdout}\n${res.stderr}`;
    const authUrl = extractAuthUrl(combined);

    if (authUrl) {
      const body: any = { ok: true, authUrl };
      return body;
    }

    // If we're already logged in, `tailscale login` won't necessarily output a URL.
    if (res.ok) {
      return { ok: true, authUrl: '', alreadyLoggedIn: true, message: 'Already logged in.' } as any;
    }

    reply.code(502);
    const body: TailscaleAuthUrlResponse = {
      ok: false,
      error: 'TAILSCALE_AUTH_URL_FAILED',
      message: 'Could not obtain Tailscale login URL from tailscale CLI output.',
      details: combined.slice(0, 800)
    };
    return body;
  });

  app.get('/api/tailscale/status', async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAdmin(db, request);

    const hasAuthKey = await hasSecret(db, 'tailscale_auth_key');

    const statusRes = await runTailscale(['status', '--json']);
    if (!statusRes.ok) {
      // Common when tailscaled isn't running yet, or no permissions (/dev/net/tun, NET_ADMIN).
      reply.code(200);
      return {
        supported: true,
        running: false,
        error: 'TAILSCALE_UNAVAILABLE',
        message: 'tailscale status failed. Is tailscaled running with /dev/net/tun and NET_ADMIN?',
        details: statusRes.stderr.slice(0, 500),
        hasAuthKey
      };
    }

    const statusJson = parseJsonOrNull(statusRes.stdout);
    const prefsRes = await runTailscale(['debug', 'prefs']);
    const prefsJson = prefsRes.ok ? parseJsonOrNull(prefsRes.stdout) : null;

    const self = statusJson?.Self ?? null;
    const backendState = typeof statusJson?.BackendState === 'string' ? statusJson.BackendState : '';
    const tailscaleIps = Array.isArray(self?.TailscaleIPs) ? self.TailscaleIPs : [];

    const advertiseRoutes = prefsJson && Array.isArray(prefsJson?.AdvertiseRoutes) ? prefsJson.AdvertiseRoutes : [];
    const advertisesExitNode =
      Boolean(prefsJson?.AdvertiseExitNode) || advertiseRoutes.includes('0.0.0.0/0') || advertiseRoutes.includes('::/0');

    return {
      supported: true,
      running: true,
      backendState,
      hasAuthKey,
      self: {
        hostName: typeof self?.HostName === 'string' ? self.HostName : '',
        dnsName: typeof self?.DNSName === 'string' ? self.DNSName : '',
        tailscaleIps
      },
      prefs: prefsJson
        ? {
            advertiseExitNode: advertisesExitNode,
            advertiseRoutes,
            snatSubnetRoutes: prefsJson?.NoSNAT === true ? false : true,
            corpDns: prefsJson?.CorpDNS !== false,
            wantRunning: prefsJson?.WantRunning !== false,
            loggedOut: prefsJson?.LoggedOut === true
          }
        : null,
      socket: TS_SOCKET
    };
  });

  app.post(
    '/api/tailscale/up',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            authKey: { type: 'string', minLength: 1, maxLength: 256 },
            hostname: { type: 'string', minLength: 1, maxLength: 64 },
            advertiseExitNode: { type: 'boolean' },
            advertiseRoutes: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 64 }, maxItems: 50 },
            snatSubnetRoutes: { type: 'boolean' },
            acceptDns: { type: 'boolean' }
          }
        }
      }
    },
    async (request: FastifyRequest<{ Body: TailscaleUpBody }>, reply: FastifyReply) => {
      await requireAdmin(db, request);

      // Prefer explicit authKey, else stored secret.
      let authKey = String(request.body?.authKey ?? '').trim();
      if (!authKey) {
        authKey = (await getSecret(db, config, 'tailscale_auth_key')).trim();
      }

      const hostname = String(request.body?.hostname ?? '').trim();
      const advertiseExitNode = request.body?.advertiseExitNode === true;
      const advertiseRoutes = Array.isArray(request.body?.advertiseRoutes) ? request.body.advertiseRoutes : [];
      const snatSubnetRoutes = request.body?.snatSubnetRoutes !== false;
      const acceptDns = request.body?.acceptDns === true;

      const args: string[] = ['up'];
      if (authKey) args.push(`--authkey=${authKey}`);
      if (hostname) args.push(`--hostname=${hostname}`);

      // We run our own DNS and want to be *the* resolver; don't accept tailnet DNS by default.
      args.push(`--accept-dns=${acceptDns ? 'true' : 'false'}`);

      // Exit node advertisement allows other tailnet devices to route all traffic through Sentinel.
      args.push(`--advertise-exit-node=${advertiseExitNode ? 'true' : 'false'}`);

      if (advertiseRoutes.length > 0) {
        args.push(`--advertise-routes=${advertiseRoutes.join(',')}`);
        args.push(`--snat-subnet-routes=${snatSubnetRoutes ? 'true' : 'false'}`);
      } else {
        // Even without routes, for exit node use-cases SNAT should stay enabled.
        args.push(`--snat-subnet-routes=${snatSubnetRoutes ? 'true' : 'false'}`);
      }

      const res = await runTailscale(args);
      if (!res.ok) {
        const combined = `${res.stdout}\n${res.stderr}`;
        const authUrl = extractAuthUrl(combined);
        if (authUrl) {
          reply.code(200);
          return {
            ok: false,
            needsLogin: true,
            authUrl,
            message: 'Open the official Tailscale login URL to authenticate this device.'
          };
        }

        reply.code(502);
        return {
          error: 'TAILSCALE_UP_FAILED',
          message: authKey
            ? 'tailscale up failed'
            : 'tailscale up failed (no auth key; and no login URL was returned)',
          details: combined.slice(0, 800)
        };
      }

      return { ok: true };
    }
  );

  app.post('/api/tailscale/down', async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAdmin(db, request);
    const res = await runTailscale(['down']);
    if (!res.ok) {
      reply.code(502);
      return { error: 'TAILSCALE_DOWN_FAILED', message: 'tailscale down failed', details: res.stderr.slice(0, 800) };
    }
    return { ok: true };
  });

  app.post(
    '/api/tailscale/config',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            hostname: { type: 'string', minLength: 1, maxLength: 64 },
            advertiseExitNode: { type: 'boolean' },
            advertiseRoutes: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 64 }, maxItems: 50 },
            snatSubnetRoutes: { type: 'boolean' },
            acceptDns: { type: 'boolean' }
          }
        }
      }
    },
    async (request: FastifyRequest<{ Body: TailscaleConfigBody }>, reply: FastifyReply) => {
      await requireAdmin(db, request);

      const hostname = String(request.body?.hostname ?? '').trim();
      const advertiseExitNode = request.body?.advertiseExitNode === true;
      const advertiseRoutes = Array.isArray(request.body?.advertiseRoutes) ? request.body.advertiseRoutes : [];
      const snatSubnetRoutes = request.body?.snatSubnetRoutes !== false;
      const acceptDns = request.body?.acceptDns === true;

      // `tailscale set` is fast and only changes specified prefs (unlike `tailscale up`).
      const args: string[] = ['set'];
      if (hostname) args.push(`--hostname=${hostname}`);
      args.push(`--accept-dns=${acceptDns ? 'true' : 'false'}`);
      args.push(`--advertise-exit-node=${advertiseExitNode ? 'true' : 'false'}`);
      args.push(`--advertise-routes=${advertiseRoutes.join(',')}`);
      args.push(`--snat-subnet-routes=${snatSubnetRoutes ? 'true' : 'false'}`);

      const res = await runTailscale(args);
      if (!res.ok) {
        const combined = `${res.stdout}\n${res.stderr}`;
        const authUrl = extractAuthUrl(combined);
        if (authUrl) {
          reply.code(200);
          return {
            ok: false,
            needsLogin: true,
            authUrl,
            message: 'Open the official Tailscale login URL to authenticate this device.'
          };
        }
        reply.code(502);
        return {
          error: 'TAILSCALE_CONFIG_FAILED',
          message: 'tailscale config failed',
          details: combined.slice(0, 800)
        };
      }
      return { ok: true };
    }
  );

  void config;
}
