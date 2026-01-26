import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig } from '../../src/config.js';

const execFileAsync = promisify(execFile);

async function docker(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('docker', args, { windowsHide: true });
  return String(stdout || '').trim();
}

export async function hasDocker(): Promise<boolean> {
  try {
    await docker(['version']);
    return true;
  } catch {
    return false;
  }
}

function randomPassword(): string {
  return `pw-${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

async function waitForPostgres(url: string, timeoutMs = 60_000): Promise<void> {
  const started = Date.now();
  const { Pool } = await import('pg');

  while (Date.now() - started < timeoutMs) {
    const pool = new Pool({ connectionString: url });
    try {
      const res = await pool.query('SELECT 1 as ok');
      if (res.rows?.[0]?.ok === 1) return;
    } catch {
      // ignore
    } finally {
      await pool.end().catch(() => undefined);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error('Timed out waiting for Postgres');
}

export type PostgresContainer = {
  containerName: string;
  databaseUrl: string;
  stop: () => Promise<void>;
};

export async function startPostgresContainer(): Promise<PostgresContainer> {
  const containerName = `sentinel-it-pg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const password = randomPassword();

  // Start Postgres on an ephemeral host port (127.0.0.1 only).
  await docker([
    'run',
    '-d',
    '--name',
    containerName,
    '-e',
    'POSTGRES_USER=sentinel',
    '-e',
    `POSTGRES_PASSWORD=${password}`,
    '-e',
    'POSTGRES_DB=sentinel',
    '-p',
    '127.0.0.1::5432',
    'postgres:15'
  ]);

  const portLine = await docker(['port', containerName, '5432/tcp']);
  const m = portLine.match(/:(\d+)\s*$/m);
  if (!m) throw new Error(`Could not parse docker port output: ${portLine}`);

  const port = Number(m[1]);
  const databaseUrl = `postgres://sentinel:${encodeURIComponent(password)}@127.0.0.1:${port}/sentinel`;
  await waitForPostgres(databaseUrl, 60_000);

  return {
    containerName,
    databaseUrl,
    stop: async () => {
      try {
        await docker(['rm', '-f', containerName]);
      } catch {
        // ignore
      }
    }
  };
}

export type TestApp = {
  app: any;
  close: () => Promise<void>;
};

export async function startTestApp(databaseUrl: string): Promise<TestApp> {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  process.env.ENABLE_DNS = 'false';
  process.env.FRONTEND_ORIGIN = 'http://localhost';

  const config = loadConfig();
  // Lazy import to allow per-test vi.mock() of route dependencies before app startup.
  const { buildApp } = await import('../../src/app.js');
  const built = await buildApp(config, {
    enableDns: false,
    enableStatic: false,
    enableBlocklistRefreshJobs: false
  });

  return { app: built.app, close: built.close };
}

export function extractSessionCookie(setCookieHeader: unknown): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : String(setCookieHeader || '');
  const m = raw.match(/\b(sentinel_session=[^;]+)/);
  return m ? m[1] : '';
}
