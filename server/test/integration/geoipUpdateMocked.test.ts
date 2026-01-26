import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as tar from 'tar';

import { extractSessionCookie, hasDocker, startPostgresContainer, startTestApp } from './_harness.js';

type FetchType = typeof fetch;

async function createMaxMindLikeTarGz(editionId: 'GeoLite2-City' | 'GeoLite2-Country'): Promise<Buffer> {
  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sentinel-geoip-archive-'));
  const innerDir = path.join(tmpRoot, `${editionId}_TEST`);
  await fs.promises.mkdir(innerDir, { recursive: true });
  await fs.promises.writeFile(path.join(innerDir, `${editionId}.mmdb`), Buffer.from('dummy-mmdb-content'));

  const outPath = path.join(tmpRoot, 'archive.tar.gz');
  await tar.c({ gzip: true, file: outPath, cwd: tmpRoot }, [path.basename(innerDir)]);

  const buf = await fs.promises.readFile(outPath);
  await fs.promises.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  return buf;
}

describe('integration: GeoIP MaxMind update (mocked download)', () => {
  let dockerOk = false;
  let pg: Awaited<ReturnType<typeof startPostgresContainer>> | null = null;
  let closeApp: (() => Promise<void>) | null = null;
  let app: any;
  let cookie = '';
  let tmpDataDir = '';
  let dbPath = '';
  let originalFetch: FetchType | null = null;

  beforeAll(async () => {
    dockerOk = await hasDocker();
    if (!dockerOk) return;

    pg = await startPostgresContainer();

    tmpDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sentinel-geoip-data-'));
    dbPath = path.join(tmpDataDir, 'GeoLite2-City.mmdb');

    // Ensure GeoIP route writes to a Windows-safe temp directory.
    process.env.DATA_DIR = tmpDataDir;
    process.env.GEOIP_DB_PATH = dbPath;

    const built = await startTestApp(pg.databaseUrl);
    app = built.app;
    closeApp = built.close;

    const username = `it-${Date.now()}`;
    const password = `it-pass-${crypto.randomBytes(8).toString('hex')}-12345678`;

    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username, password }
    });

    cookie = extractSessionCookie(setup.headers['set-cookie']);
    if (!cookie) throw new Error('Missing session cookie from /api/auth/setup');

    // Mock only MaxMind download fetch; delegate everything else.
    originalFetch = globalThis.fetch;
    const tarGz = await createMaxMindLikeTarGz('GeoLite2-City');

    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : typeof input?.url === 'string' ? input.url : '';
      if (url.startsWith('https://download.maxmind.com/app/geoip_download')) {
        return new Response(new Uint8Array(tarGz), { status: 200, headers: { 'content-type': 'application/gzip' } });
      }
      return (originalFetch as FetchType)(input, init);
    }) as FetchType;
  }, 120_000);

  afterAll(async () => {
    if (originalFetch) globalThis.fetch = originalFetch;

    try {
      await closeApp?.();
    } catch {
      // ignore
    }

    await pg?.stop().catch(() => undefined);

    if (tmpDataDir) {
      await fs.promises.rm(tmpDataDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }, 120_000);

  it('skips if Docker is unavailable', async () => {
    if (!dockerOk) {
      expect(dockerOk).toBe(false);
      return;
    }
    expect(dockerOk).toBe(true);
  });

  it('POST /api/geoip/update installs the mmdb file (no real network)', async () => {
    if (!dockerOk) return;

    const res = await app.inject({
      method: 'POST',
      url: '/api/geoip/update',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { licenseKey: 'test-key', editionId: 'GeoLite2-City' }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, editionId: 'GeoLite2-City' });

    expect(fs.existsSync(dbPath)).toBe(true);

    const st = await app.inject({ method: 'GET', url: '/api/geoip/status', headers: { cookie } });
    expect(st.statusCode).toBe(200);
    expect(st.json()).toHaveProperty('lastUpdatedAt');
  });
});
