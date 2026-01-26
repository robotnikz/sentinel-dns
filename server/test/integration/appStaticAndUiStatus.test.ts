import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

function getRepoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // server/test/integration -> repo root
  return path.resolve(here, '..', '..', '..');
}

describe('integration: app static + /api/ui/status (no real DB)', () => {
  it('serves /api/ui/status and SPA fallback when dist/ exists', async () => {
    vi.resetModules();

    // Create a minimal dist/ so app.ts enables static + SPA fallback.
    const repoRoot = getRepoRoot();
    const distDir = path.join(repoRoot, 'dist');
    const indexPath = path.join(distDir, 'index.html');

    const distExisted = fs.existsSync(distDir);
    const indexExisted = fs.existsSync(indexPath);

    if (!distExisted) fs.mkdirSync(distDir, { recursive: true });
    if (!indexExisted) {
      fs.writeFileSync(
        indexPath,
        '<!doctype html><html><head>' +
          '<link href="/assets/app.css" rel="stylesheet">' +
          '</head><body>' +
          '<script src="/assets/app.js"></script>' +
          '</body></html>',
        'utf8'
      );
    }

    try {
      vi.doMock('../../src/db.js', () => ({
        createDb: () => ({
          init: async () => undefined,
          pool: {
            query: async () => ({ rows: [], rowCount: 0 }),
            end: async () => undefined
          }
        })
      }));

      vi.doMock('../../src/blocklists/seedDefaults.js', () => ({
        ensureDefaultBlocklists: async () => undefined
      }));

      vi.doMock('../../src/blocklists/refresh.js', () => ({
        refreshBlocklist: async () => undefined
      }));

      // Make all route modules no-ops so we can focus on app.ts behavior.
      const noop = async () => undefined;
      vi.doMock('../../src/routes/health.js', () => ({ registerHealthRoutes: noop }));
      vi.doMock('../../src/routes/auth.js', () => ({ registerAuthRoutes: noop }));
      vi.doMock('../../src/routes/ai.js', () => ({ registerAiRoutes: noop }));
      vi.doMock('../../src/routes/rules.js', () => ({ registerRulesRoutes: noop }));
      vi.doMock('../../src/routes/settings.js', () => ({ registerSettingsRoutes: noop }));
      vi.doMock('../../src/routes/notifications.js', () => ({ registerNotificationRoutes: noop }));
      vi.doMock('../../src/routes/clients.js', () => ({ registerClientsRoutes: noop }));
      vi.doMock('../../src/routes/queryLogs.js', () => ({ registerQueryLogsRoutes: noop }));
      vi.doMock('../../src/routes/secrets.js', () => ({ registerSecretsRoutes: noop }));
      vi.doMock('../../src/routes/dns.js', () => ({ registerDnsRoutes: noop }));
      vi.doMock('../../src/routes/rewrites.js', () => ({ registerRewritesRoutes: noop }));
      vi.doMock('../../src/routes/blocklists.js', () => ({ registerBlocklistsRoutes: noop }));
      vi.doMock('../../src/routes/metrics.js', () => ({ registerMetricsRoutes: noop }));
      vi.doMock('../../src/routes/geo.js', () => ({ registerGeoRoutes: noop }));
      vi.doMock('../../src/routes/geoip.js', () => ({ registerGeoIpRoutes: noop }));
      vi.doMock('../../src/routes/protection.js', () => ({ registerProtectionRoutes: noop }));
      vi.doMock('../../src/routes/discovery.js', () => ({ registerDiscoveryRoutes: noop }));
      vi.doMock('../../src/routes/cluster.js', () => ({ registerClusterRoutes: noop }));
      vi.doMock('../../src/routes/tailscale.js', () => ({ registerTailscaleRoutes: noop }));
      vi.doMock('../../src/routes/version.js', () => ({ registerVersionRoutes: noop }));

      vi.doMock('../../src/dns/dnsServer.js', () => ({
        startDnsServer: async () => ({ close: async () => undefined })
      }));

      vi.doMock('../../src/auth.js', () => ({
        requireAdmin: async () => undefined
      }));

      const { buildApp } = await import('../../src/app.js');

      const config = {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: 0,
        FRONTEND_ORIGIN: 'http://localhost',
        ENABLE_DNS: false,
        DNS_HOST: '127.0.0.1',
        DNS_PORT: 53,
        UPSTREAM_DNS: '127.0.0.1:5335',
        SHADOW_RESOLVE_BLOCKED: false,
        DATA_DIR: '/data',
        ADMIN_TOKEN: '',
        DATABASE_URL: 'postgres://sentinel:sentinel@localhost:5432/sentinel',
        GEMINI_API_KEY: '',
        GEOIP_DB_PATH: '/data/GeoLite2-City.mmdb',
        SECRETS_KEY: ''
      } as any;

      const built = await buildApp(config, { enableDns: false, enableBlocklistRefreshJobs: false, enableStatic: true });

      const ui = await built.app.inject({ method: 'GET', url: '/api/ui/status' });
      expect(ui.statusCode).toBe(200);
      const body = ui.json();
      expect(body.ok).toBe(true);
      expect(body.indexExists).toBe(true);
      expect(Array.isArray(body.assetUrls)).toBe(true);
      const assetUrls: string[] = body.assetUrls;
      expect(assetUrls.length).toBeGreaterThan(0);
      expect(assetUrls.some((u) => typeof u === 'string' && u.startsWith('/assets/') && u.endsWith('.js'))).toBe(true);
      // If CSS exists, we should capture it too (some builds might inline).
      expect(assetUrls.every((u) => typeof u === 'string' && u.startsWith('/assets/'))).toBe(true);

      const api404 = await built.app.inject({ method: 'GET', url: '/api/does-not-exist' });
      expect(api404.statusCode).toBe(404);
      expect(api404.json()).toEqual({ error: 'NOT_FOUND' });

      const spa = await built.app.inject({ method: 'GET', url: '/some/deep/link', headers: { accept: 'text/html' } });
      expect(spa.statusCode).toBe(200);
      expect(spa.headers['content-type'] || '').toContain('text/html');
      expect(String(spa.body).toLowerCase()).toContain('<!doctype html>');

      await built.close();
    } finally {
      // Restore dist folder only if we created it.
      if (!indexExisted && fs.existsSync(indexPath)) {
        try {
          fs.rmSync(indexPath, { force: true });
        } catch {
          // ignore
        }
      }
      if (!distExisted && fs.existsSync(distDir)) {
        try {
          fs.rmSync(distDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    }
  });
});
