import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import 'fastify-rate-limit';

type StatFs = {
  type: number;
  bsize: number;
  blocks: number;
  bfree: number;
  bavail: number;
  files: number;
  ffree: number;
};

async function statFsSafe(targetPath: string): Promise<StatFs | null> {
  const anyFs: any = fs;
  if (typeof anyFs?.promises?.statfs !== 'function') return null;
  try {
    return (await anyFs.promises.statfs(targetPath)) as StatFs;
  } catch {
    return null;
  }
}

async function readFirstExistingFile(paths: string[]): Promise<string | null> {
  for (const p of paths) {
    try {
      if (!fs.existsSync(p)) continue;
      const txt = await fs.promises.readFile(p, 'utf8');
      const s = String(txt ?? '').trim();
      if (s) return s;
    } catch {
      // ignore
    }
  }
  return null;
}

function parseCgroupLimit(raw: string | null): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  if (s === 'max') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;

  // Common “no limit” sentinel in cgroup v1.
  if (n >= 0x7ffffffffffff000) return null;
  return Math.floor(n);
}

export async function registerSystemRoutes(app: FastifyInstance, config: AppConfig, db: Db): Promise<void> {
  app.get(
    '/api/system/status',
    {
      config: {
        rateLimit: { max: 60, timeWindow: '1 minute' }
      },
      preHandler: app.rateLimit()
    },
    async (req, reply) => {
      await requireAdmin(db, req);

      const now = new Date();
      const mem = process.memoryUsage();

      const dataDir = String((config as any).DATA_DIR || '/data');
      const diskPath = path.isAbsolute(dataDir) ? dataDir : path.resolve('/', dataDir);
      const diskStat = await statFsSafe(diskPath);

      const rootPath = '/';
      const rootStat = await statFsSafe(rootPath);

      const disk = diskStat
        ? (() => {
            const blockSize = Number(diskStat.bsize) || 4096;
            const totalBytes = Math.max(0, Number(diskStat.blocks) * blockSize);
            const freeBytes = Math.max(0, Number(diskStat.bfree) * blockSize);
            const availableBytes = Math.max(0, Number(diskStat.bavail) * blockSize);
            const usedBytes = Math.max(0, totalBytes - freeBytes);
            return {
              path: diskPath,
              blockSize,
              totalBytes,
              usedBytes,
              freeBytes,
              availableBytes
            };
          })()
        : {
            path: diskPath,
            blockSize: null,
            totalBytes: null,
            usedBytes: null,
            freeBytes: null,
            availableBytes: null
          };

      const diskRoot = rootStat
        ? (() => {
            const blockSize = Number(rootStat.bsize) || 4096;
            const totalBytes = Math.max(0, Number(rootStat.blocks) * blockSize);
            const freeBytes = Math.max(0, Number(rootStat.bfree) * blockSize);
            const availableBytes = Math.max(0, Number(rootStat.bavail) * blockSize);
            const usedBytes = Math.max(0, totalBytes - freeBytes);
            return {
              path: rootPath,
              blockSize,
              totalBytes,
              usedBytes,
              freeBytes,
              availableBytes
            };
          })()
        : {
            path: rootPath,
            blockSize: null,
            totalBytes: null,
            usedBytes: null,
            freeBytes: null,
            availableBytes: null
          };

      const cgroupMemoryRaw = await readFirstExistingFile([
        // cgroup v2
        '/sys/fs/cgroup/memory.max',
        // cgroup v1
        '/sys/fs/cgroup/memory/memory.limit_in_bytes'
      ]);
      const cgroupMemoryLimitBytes = parseCgroupLimit(cgroupMemoryRaw);

      // Prevent caching so the UI gets live-ish values.
      reply.header('cache-control', 'no-store');
      return {
        ok: true,
        timestamp: now.toISOString(),
        dataDir,
        os: {
          hostname: os.hostname(),
          platform: os.platform(),
          arch: os.arch(),
          release: os.release(),
          uptimeSec: Math.floor(os.uptime()),
          loadavg: os.loadavg(),
          cpuCount: os.cpus()?.length ?? null,
          totalMemBytes: os.totalmem(),
          freeMemBytes: os.freemem()
        },
        process: {
          pid: process.pid,
          nodeVersion: process.version,
          uptimeSec: Math.floor(process.uptime()),
          rssBytes: mem.rss,
          heapUsedBytes: mem.heapUsed,
          heapTotalBytes: mem.heapTotal,
          externalBytes: mem.external
        },
        cgroup: {
          memoryLimitBytes: cgroupMemoryLimitBytes
        },
        disk
        ,
        diskRoot
      };
    }
  );
}
