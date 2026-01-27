import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from 'fastify-rate-limit';
import fastifyStatic from '@fastify/static';
import cookie from '@fastify/cookie';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AppConfig } from './config.js';
import { createDb } from './db.js';
import { ensureDefaultBlocklists } from './blocklists/seedDefaults.js';
import { refreshBlocklist } from './blocklists/refresh.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerRulesRoutes } from './routes/rules.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerClusterRoutes } from './routes/cluster.js';
import { registerTailscaleRoutes } from './routes/tailscale.js';
import { registerVersionRoutes } from './routes/version.js';
import { registerNotificationRoutes } from './routes/notifications.js';
import { registerClientsRoutes } from './routes/clients.js';
import { registerQueryLogsRoutes } from './routes/queryLogs.js';
import { registerSecretsRoutes } from './routes/secrets.js';
import { registerDnsRoutes } from './routes/dns.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerBlocklistsRoutes } from './routes/blocklists.js';
import { registerMetricsRoutes } from './routes/metrics.js';
import { registerRewritesRoutes } from './routes/rewrites.js';
import { registerGeoRoutes } from './routes/geo.js';
import { registerGeoIpRoutes } from './routes/geoip.js';
import { registerProtectionRoutes } from './routes/protection.js';
import { registerDiscoveryRoutes } from './routes/discovery.js';
import { registerOpenApiRoutes } from './routes/openapi.js';
import { startDnsServer } from './dns/dnsServer.js';
import { requireAdmin } from './auth.js';
import { startMaintenanceJobs } from './maintenance.js';

export type BuildAppOptions = {
  enableStatic?: boolean;
  enableDns?: boolean;
  enableBlocklistRefreshJobs?: boolean;
};

export async function buildApp(config: AppConfig, options: BuildAppOptions = {}) {
  const enableStatic = options.enableStatic ?? true;
  const enableDns = options.enableDns ?? true;
  const enableBlocklistRefreshJobs = options.enableBlocklistRefreshJobs ?? true;

  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            level: config.NODE_ENV === 'production' ? 'info' : 'debug'
          },
    // Needed so Fastify derives protocol from X-Forwarded-* when behind a reverse proxy.
    trustProxy: config.TRUST_PROXY
  });

  // IMPORTANT:
  // We serve plain HTTP by default (typical LAN/VPS + optional reverse proxy).
  // Helmet defaults currently include a CSP with `upgrade-insecure-requests`, which
  // causes browsers (notably Firefox) to upgrade our `/assets/*` requests to HTTPS.
  // If TLS is not terminated in front, that results in a white page.
  // For this appliance-style deployment, disable CSP+HSTS by default.
  await app.register(helmet, { global: true, contentSecurityPolicy: false, hsts: false });
  await app.register(cookie);
  await app.register(cors, {
    origin: config.FRONTEND_ORIGIN,
    credentials: true
  });

  await app.register(rateLimit, {
    global: false,
    max: 200,
    timeWindow: '1 minute'
  });

  const db = createDb(config);
  await db.init();

  const maintenance = startMaintenanceJobs(config, db);

  // First-run convenience: seed a small baseline set of enabled blocklists.
  // Safe to call repeatedly; it only runs when no blocklists exist.
  await ensureDefaultBlocklists(db);

  // Discovery helpers (observed clients + reverse DNS)
  await registerDiscoveryRoutes(app, config, db);

  let refreshTimeout: NodeJS.Timeout | undefined;
  let refreshInterval: NodeJS.Timeout | undefined;

  if (enableBlocklistRefreshJobs) {
    // Keep blocklists fresh (includes category lists). Runs in the background.
    const refreshEnabledBlocklists = async () => {
      try {
        const res = await db.pool.query('SELECT id, name, url FROM blocklists WHERE enabled = true ORDER BY id ASC');
        for (const row of res.rows) {
          const id = Number(row?.id);
          const name = String(row?.name ?? '');
          const url = String(row?.url ?? '');
          if (!Number.isFinite(id) || !name || !url) continue;
          try {
            await refreshBlocklist(db, { id, name, url });
          } catch {
            // Per-list errors are recorded by the refresh route; here we just keep going.
          }
        }
      } catch {
        // ignore
      }
    };

    // Refresh shortly after startup, then daily.
    refreshTimeout = setTimeout(() => void refreshEnabledBlocklists(), 60_000);
    refreshInterval = setInterval(() => void refreshEnabledBlocklists(), 24 * 60 * 60 * 1000);
  }

  // Serve built frontend (single-port mode) if `dist/` exists.
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const distDir = path.resolve(__dirname, '../../dist');

  // Diagnostics: helps debug "white page" reports in production without shell access.
  app.get(
    '/api/ui/status',
    {
      // This endpoint reads the filesystem; keep it cheap to call.
      config: {
        rateLimit: { max: 30, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit()
    },
    async (req, reply) => {
      await requireAdmin(db, req);
      const distExists = fs.existsSync(distDir);
      const indexPath = path.join(distDir, 'index.html');
      const indexExists = distExists && fs.existsSync(indexPath);

      let assetUrls: string[] = [];
      if (indexExists) {
        try {
          const html = fs.readFileSync(indexPath, 'utf8');
          const urls = new Set<string>();
          for (const match of html.matchAll(/\b(?:src|href)="(\/assets\/[^\"]+)"/g)) {
            if (match[1]) urls.add(String(match[1]));
          }
          assetUrls = Array.from(urls).slice(0, 20);
        } catch {
          // ignore
        }
      }

      // Prevent caching so troubleshooting is accurate.
      reply.header('cache-control', 'no-store');
      return {
        ok: true,
        distDir,
        distExists,
        indexExists,
        assetUrls
      };
    }
  );

  if (enableStatic && fs.existsSync(distDir)) {
    await app.register(fastifyStatic, { root: distDir });

    // SPA fallback for browser navigations:
    // - never intercept /api
    // - only serve index.html for requests that look like HTML navigation
    //   (prevents returning HTML for missing JS/CSS, which causes white screens)
    app.setNotFoundHandler(async (req, reply) => {
      const url = req.raw.url || '';
      if (url.startsWith('/api/')) {
        reply.code(404);
        return { error: 'NOT_FOUND' };
      }

      const accept = String(req.headers.accept || '');
      const wantsHtml = accept.includes('text/html') || accept.includes('*/*');
      const looksLikeFile = /\.[a-z0-9]+($|\?)/i.test(url);
      if (req.method === 'GET' && wantsHtml && !looksLikeFile) {
        return reply.sendFile('index.html');
      }

      reply.code(404);
      return 'NOT_FOUND';
    });
  }

  await registerHealthRoutes(app, config);
  await registerAuthRoutes(app, config, db);
  await registerAiRoutes(app, config, db);
  await registerRulesRoutes(app, config, db);
  await registerSettingsRoutes(app, config, db);
  await registerNotificationRoutes(app, config, db);
  await registerClientsRoutes(app, config, db);
  await registerQueryLogsRoutes(app, config, db);
  await registerSecretsRoutes(app, config, db);
  await registerDnsRoutes(app, config, db);
  await registerRewritesRoutes(app, config, db);
  await registerBlocklistsRoutes(app, config, db);
  await registerMetricsRoutes(app, config, db);
  await registerGeoRoutes(app, config, db);
  await registerGeoIpRoutes(app, config, db);
  await registerProtectionRoutes(app, config, db);
  await registerOpenApiRoutes(app, config, db);
  await registerClusterRoutes(app, db);
  await registerTailscaleRoutes(app, config, db);
  await registerVersionRoutes(app);

  const dns = enableDns && config.ENABLE_DNS ? await startDnsServer(config, db) : null;

  await app.ready();

  async function close(): Promise<void> {
    if (refreshTimeout) clearTimeout(refreshTimeout);
    if (refreshInterval) clearInterval(refreshInterval);
    try {
      await maintenance.close();
    } catch {
      // ignore
    }
    try {
      await dns?.close();
    } catch {
      // ignore
    }
    try {
      await app.close();
    } catch {
      // ignore
    }
    await db.pool.end();
  }

  return { app, db, close };
}
