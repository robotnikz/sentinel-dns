import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import * as tar from 'tar';

import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { getSecret, hasSecret } from '../secretsStore.js';
import { getGeoIpEditionId, getGeoIpStatus } from '../geoip/geoip.js';
import { notifyEvent } from '../notifications/notify.js';
import 'fastify-rate-limit';

type GeoIpUpdateBody = {
  // Optional: allow one-off update without storing the key (still admin-only).
  licenseKey?: string;
  // Optional override. Defaults to City to enable map dots.
  editionId?: 'auto' | 'GeoLite2-City' | 'GeoLite2-Country';
};

async function upsertSetting(db: Db, key: string, value: unknown): Promise<void> {
  await db.pool.query(
    'INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
    [key, value]
  );
}

async function getSetting(db: Db, key: string): Promise<any> {
  const res = await db.pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return res.rows?.[0]?.value;
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function walkFiles(dir: string, out: string[]): Promise<void> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walkFiles(p, out);
    else if (e.isFile()) out.push(p);
  }
}

function buildMaxMindDownloadUrl(editionId: string, licenseKey: string): string {
  const url = new URL('https://download.maxmind.com/app/geoip_download');
  url.searchParams.set('edition_id', editionId);
  url.searchParams.set('license_key', licenseKey);
  url.searchParams.set('suffix', 'tar.gz');
  return url.toString();
}

export async function registerGeoIpRoutes(app: FastifyInstance, config: AppConfig, db: Db): Promise<void> {
  app.get(
    '/api/geoip/status',
    {
      config: {
        rateLimit: { max: 60, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit()
    },
    async (request) => {
      await requireAdmin(db, request);

    const geoip = await getGeoIpStatus(config);
    const hasKey = await hasSecret(db, 'maxmind_license_key');

    const detectedEditionId = geoip.available ? await getGeoIpEditionId(config) : 'Unknown';

    const meta = await getSetting(db, 'geoip_worldmap');
    const lastUpdatedAt = typeof meta?.lastUpdatedAt === 'string' ? meta.lastUpdatedAt : null;
    const lastError = typeof meta?.lastError === 'string' ? meta.lastError : '';
    const lastEditionId = typeof meta?.lastEditionId === 'string' ? meta.lastEditionId : '';

      return {
        geoip,
        editionId: lastEditionId || detectedEditionId || 'Unknown',
        hasLicenseKey: hasKey,
        lastUpdatedAt,
        lastError
      };
    }
  );

  app.post(
    '/api/geoip/update',
    {
      config: {
        rateLimit: { max: 5, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit(),
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            licenseKey: { type: 'string', minLength: 1, maxLength: 256 },
            editionId: { type: 'string', enum: ['auto', 'GeoLite2-City', 'GeoLite2-Country'] }
          }
        }
      }
    },
    async (request: FastifyRequest<{ Body: GeoIpUpdateBody }>, reply: FastifyReply) => {
      await requireAdmin(db, request);

      const requestedEditionId = String(request.body?.editionId ?? 'auto');
      const editionId: 'GeoLite2-City' | 'GeoLite2-Country' =
        requestedEditionId === 'GeoLite2-Country' ? 'GeoLite2-Country' : 'GeoLite2-City';
      const dbPath = String(config.GEOIP_DB_PATH ?? '').trim();
      if (!dbPath) {
        reply.code(500);
        return { error: 'GEOIP_DB_PATH_MISSING', message: 'Server GEOIP_DB_PATH is not set.' };
      }

      let licenseKey = String(request.body?.licenseKey ?? '').trim();
      if (!licenseKey) {
        licenseKey = (await getSecret(db, config, 'maxmind_license_key')).trim();
      }

      if (!licenseKey) {
        reply.code(400);
        return { error: 'LICENSE_KEY_MISSING', message: 'Set a MaxMind license key in Settings first.' };
      }

      const tmpDir = path.join(String(config.DATA_DIR || '/data'), 'sentinel', 'tmp');
      const extractDir = path.join(tmpDir, `geoip_extract_${Date.now()}`);
      ensureDir(tmpDir);
      ensureDir(extractDir);

      const archivePath = path.join(tmpDir, `${editionId}_${Date.now()}.tar.gz`);

      try {
        const url = buildMaxMindDownloadUrl(editionId, licenseKey);
        const resp = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'sentinel-dns/geoip-worldmap'
          }
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          const firstLine = String(text || '')
            .trim()
            .split(/\r?\n/)[0]
            .slice(0, 200);

          try {
            await notifyEvent(db, config, 'geoIpUpdated', {
              title: 'GeoIP update failed',
              message: `MaxMind download failed (${resp.status}).${firstLine ? ` ${firstLine}` : ''}`,
              severity: 'error',
              meta: { editionId }
            });
          } catch {
            // ignore
          }

          reply.code(502);
          return {
            error: 'DOWNLOAD_FAILED',
            message: `MaxMind download failed (${resp.status}).${firstLine ? ` ${firstLine}` : ''}`,
            details: text.slice(0, 500)
          };
        }

        const buf = Buffer.from(await resp.arrayBuffer());
        await fs.promises.writeFile(archivePath, buf);

        await tar.x({ file: archivePath, cwd: extractDir, gzip: true, strict: true });

        const files: string[] = [];
        await walkFiles(extractDir, files);
        const mmdb = files.find((p) => p.endsWith(`${editionId}.mmdb`)) ?? files.find((p) => p.toLowerCase().endsWith('.mmdb'));

        if (!mmdb) {
          try {
            await notifyEvent(db, config, 'geoIpUpdated', {
              title: 'GeoIP update failed',
              message: 'Downloaded archive did not contain a .mmdb file.',
              severity: 'error',
              meta: { editionId }
            });
          } catch {
            // ignore
          }

          reply.code(502);
          return { error: 'MMDB_NOT_FOUND', message: 'Downloaded archive did not contain a .mmdb file.' };
        }

        ensureDir(path.dirname(dbPath));
        const tmpOut = `${dbPath}.tmp`;
        await fs.promises.copyFile(mmdb, tmpOut);
        await fs.promises.rename(tmpOut, dbPath);

        const now = new Date().toISOString();
        await upsertSetting(db, 'geoip_worldmap', { lastUpdatedAt: now, lastError: '', lastEditionId: editionId });

        try {
          await notifyEvent(db, config, 'geoIpUpdated', {
            title: 'GeoIP updated',
            message: `Installed ${editionId}.`,
            severity: 'info',
            meta: { editionId, dbPath }
          });
        } catch {
          // ignore
        }

        return {
          ok: true,
          editionId,
          dbPath,
          lastUpdatedAt: now
        };
      } catch (e: any) {
        const msg = typeof e?.message === 'string' ? e.message : 'Unknown error';
        await upsertSetting(db, 'geoip_worldmap', { lastUpdatedAt: null, lastError: msg, lastEditionId: editionId });

        try {
          await notifyEvent(db, config, 'geoIpUpdated', {
            title: 'GeoIP update failed',
            message: msg,
            severity: 'error',
            meta: { editionId }
          });
        } catch {
          // ignore
        }

        throw e;
      } finally {
        // Best-effort cleanup
        void fs.promises.unlink(archivePath).catch(() => {});
        void fs.promises.rm(extractDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  );
}
