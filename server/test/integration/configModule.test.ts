import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

async function withEnv(env: Record<string, string>, fn: () => Promise<void> | void): Promise<void> {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  try {
    await fn();
  } finally {
    // Restore without replacing the process.env object.
    for (const key of Object.keys(process.env)) {
      if (!(key in prev)) delete (process.env as any)[key];
    }
    Object.assign(process.env, prev);
  }
}

describe('integration: config module', () => {
  it('in production, loads/persists tokens via persistedConfig helper', async () => {
    await withEnv(
      {
        NODE_ENV: 'production',
        DATA_DIR: '/data',
        ADMIN_TOKEN: '',
        SECRETS_KEY: ''
      },
      async () => {
        vi.resetModules();

        vi.doMock('../../src/persistedConfig.js', () => ({
          loadOrCreatePersistedSecrets: () => ({
            adminToken: 'persisted-admin',
            secretsKey: 'persisted-secrets',
            createdAdminToken: true,
            createdSecretsKey: true
          })
        }));

        const { loadConfig } = await import('../../src/config.js');
        const cfg = loadConfig();

        expect(cfg.ADMIN_TOKEN).toBe('persisted-admin');
        expect(cfg.SECRETS_KEY).toBe('persisted-secrets');
      }
    );
  });

  it('best-effort migrates legacy GeoLite2-Country.mmdb to GeoLite2-City.mmdb when expected path configured', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-cfg-'));
    try {
      const expectedCityPath = path.join(dataDir, 'GeoLite2-City.mmdb');
      const legacyCountryPath = path.join(dataDir, 'GeoLite2-Country.mmdb');
      fs.writeFileSync(legacyCountryPath, 'legacy', 'utf8');

      await withEnv(
        {
          NODE_ENV: 'development',
          DATA_DIR: dataDir,
          GEOIP_DB_PATH: expectedCityPath
        },
        async () => {
          vi.resetModules();
          const { loadConfig } = await import('../../src/config.js');
          const cfg = loadConfig();

          expect(cfg.GEOIP_DB_PATH).toBe(expectedCityPath);
          expect(fs.existsSync(expectedCityPath)).toBe(true);
          expect(fs.existsSync(legacyCountryPath)).toBe(false);
        }
      );
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
