import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { extractSessionCookie, hasDocker, startPostgresContainer, startTestApp } from './_harness.js';

const mockState = vi.hoisted(() => {
  return {
    scenario: 'status-fails' as
      | 'status-fails'
      | 'status-ok'
      | 'auth-url'
      | 'already-logged-in'
      | 'up-needs-login'
      | 'up-fails'
      | 'down-fails'
      | 'config-ok'
      | 'config-fails',
    calls: [] as Array<{ file: string; args: string[] }>
  };
});

function makeExecError(opts: { stdout?: string; stderr?: string; code?: number }): any {
  const e: any = new Error(opts.stderr || 'exec failed');
  e.code = opts.code ?? 1;
  e.stdout = opts.stdout ?? '';
  e.stderr = opts.stderr ?? '';
  return e;
}

// Mock only the `tailscale` CLI calls; everything else (docker) should behave normally.
vi.mock('node:child_process', async () => {
  const actual: any = await vi.importActual('node:child_process');
  const util: any = await vi.importActual('node:util');

  function execFilePatched(...callArgs: any[]) {
    const file = callArgs[0];
    const cmd = String(file ?? '');

    const base = cmd.split(/[/\\]+/).pop()?.toLowerCase() ?? '';
    const isTailscale = base === 'tailscale' || base === 'tailscale.exe';

    if (!isTailscale) {
      // Forward without changing argument arity/signature.
      return actual.execFile(...callArgs);
    }

    const argv: string[] = Array.isArray(callArgs[1]) ? callArgs[1].map((x: any) => String(x)) : [];
    let cb: any = undefined;
    for (let i = callArgs.length - 1; i >= 0; i--) {
      if (typeof callArgs[i] === 'function') {
        cb = callArgs[i];
        break;
      }
    }
    if (typeof cb !== 'function') {
      throw new Error('execFile mock missing callback');
    }

    mockState.calls.push({ file: cmd, args: argv });

    const sub = argv[0] || '';

    const ok = (stdout: string, stderr = '') => cb(null, stdout, stderr);
    const fail = (stdout: string, stderr: string, code = 1) => cb(makeExecError({ stdout, stderr, code }), stdout, stderr);

    if (sub === 'status' && argv.includes('--json')) {
      if (mockState.scenario === 'status-ok') {
        return ok(
          JSON.stringify({
            BackendState: 'Running',
            Self: { HostName: 'sentinel', DNSName: 'sentinel.tailnet.ts.net', TailscaleIPs: ['100.64.0.1'] }
          })
        );
      }
      return fail('', 'permission denied', 1);
    }

    if (sub === 'debug' && argv[1] === 'prefs') {
      if (mockState.scenario === 'status-ok') {
        return ok(
          JSON.stringify({
            AdvertiseRoutes: ['0.0.0.0/0'],
            AdvertiseExitNode: false,
            NoSNAT: false,
            CorpDNS: true,
            WantRunning: true,
            LoggedOut: false
          })
        );
      }
      return fail('', 'prefs unavailable', 1);
    }

    if (sub === 'login') {
      if (mockState.scenario === 'auth-url') {
        return ok('To authenticate, visit: https://login.tailscale.com/a/b/c?xyz=1\n');
      }
      if (mockState.scenario === 'already-logged-in') {
        return ok('Logged in.\n');
      }
      return fail('', 'login failed', 1);
    }

    if (sub === 'up') {
      if (mockState.scenario === 'up-needs-login') {
        return fail('Please authenticate at https://login.tailscale.com/abc123\n', 'not logged in', 1);
      }
      if (mockState.scenario === 'up-fails') {
        return fail('', 'up failed', 1);
      }
      return ok('ok\n');
    }

    if (sub === 'down') {
      if (mockState.scenario === 'down-fails') {
        return fail('', 'down failed', 1);
      }
      return ok('ok\n');
    }

    if (sub === 'set') {
      if (mockState.scenario === 'config-fails') {
        return fail('', 'set failed', 1);
      }
      return ok('ok\n');
    }

    return ok('ok\n');
  }

  // Keep `promisify(execFile)` compatible with Node's built-in behavior, but ensure
  // the promisified function still routes through our patched execFile (so tailscale
  // calls get intercepted).
  try {
    const custom = util?.promisify?.custom;
    if (custom) {
      (execFilePatched as any)[custom] = (file: any, args: any, options: any) => {
        return new Promise((resolve, reject) => {
          execFilePatched(file, args, options, (err: any, stdout: any, stderr: any) => {
            if (err) {
              err.stdout = stdout;
              err.stderr = stderr;
              reject(err);
              return;
            }
            resolve({ stdout, stderr });
          });
        });
      };
    }
  } catch {
    // ignore
  }

  return {
    ...actual,
    execFile: execFilePatched
  };
});

describe('integration: tailscale routes (mocked CLI)', () => {
  let dockerOk = false;
  let pg: Awaited<ReturnType<typeof startPostgresContainer>> | null = null;
  let closeApp: (() => Promise<void>) | null = null;
  let app: any;
  let cookie = '';
  let pool: Pool | null = null;

  beforeAll(async () => {
    dockerOk = await hasDocker();
    if (!dockerOk) return;

    pg = await startPostgresContainer();
    pool = new Pool({ connectionString: pg.databaseUrl });

    const built = await startTestApp(pg.databaseUrl);
    app = built.app;
    closeApp = built.close;

    const username = `it-${Date.now()}`;
    const password = `it-pass-${Math.random().toString(16).slice(2)}-12345678`;

    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username, password }
    });

    cookie = extractSessionCookie(setup.headers['set-cookie']);
    if (!cookie) throw new Error('Missing session cookie from /api/auth/setup');

    // Keep secrets isolated.
    await pool.query("DELETE FROM settings WHERE key LIKE 'secret:%'");
  }, 120_000);

  afterEach(async () => {
    mockState.calls.length = 0;
    if (pool) {
      await pool.query("DELETE FROM settings WHERE key LIKE 'secret:%'");
    }
  });

  afterAll(async () => {
    await pool?.end().catch(() => undefined);
    try {
      await closeApp?.();
    } catch {
      // ignore
    }
    await pg?.stop().catch(() => undefined);
  }, 120_000);

  it('skips if Docker is unavailable', async () => {
    if (!dockerOk) {
      expect(dockerOk).toBe(false);
      return;
    }
    expect(dockerOk).toBe(true);
  });

  it('GET /api/tailscale/status returns running=false when CLI fails', async () => {
    if (!dockerOk) return;

    mockState.scenario = 'status-fails';

    const res = await app.inject({ method: 'GET', url: '/api/tailscale/status', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      supported: true,
      running: false,
      error: 'TAILSCALE_UNAVAILABLE',
      hasAuthKey: false
    });
  });

  it('GET /api/tailscale/status returns running=true and prefs when CLI succeeds', async () => {
    if (!dockerOk) return;
    if (!pool) throw new Error('pool not initialized');

    mockState.scenario = 'status-ok';

    // hasSecret() only checks existence.
    await pool.query('INSERT INTO settings(key, value) VALUES ($1, $2)', ['secret:tailscale_auth_key', { any: 'value' }]);

    const res = await app.inject({ method: 'GET', url: '/api/tailscale/status', headers: { cookie } });
    expect(res.statusCode).toBe(200);

    const json = res.json();
    expect(json).toMatchObject({ supported: true, running: true, backendState: 'Running', hasAuthKey: true });
    expect(json).toHaveProperty('self');
    expect(Array.isArray(json.self?.tailscaleIps)).toBe(true);
    expect(json).toHaveProperty('prefs');
    expect(json.prefs).toMatchObject({ advertiseExitNode: true });
  });

  it('POST /api/tailscale/auth-url extracts the official login URL when printed', async () => {
    if (!dockerOk) return;

    mockState.scenario = 'auth-url';

    const res = await app.inject({ method: 'POST', url: '/api/tailscale/auth-url', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    expect(String(res.json()?.authUrl || '')).toContain('https://login.tailscale.com/');
  });

  it('POST /api/tailscale/auth-url returns alreadyLoggedIn when ok but no URL', async () => {
    if (!dockerOk) return;

    mockState.scenario = 'already-logged-in';

    const res = await app.inject({ method: 'POST', url: '/api/tailscale/auth-url', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, authUrl: '' });
    expect(res.json()?.alreadyLoggedIn).toBe(true);
  });

  it('POST /api/tailscale/up returns needsLogin when CLI provides login URL', async () => {
    if (!dockerOk) return;

    mockState.scenario = 'up-needs-login';

    const res = await app.inject({
      method: 'POST',
      url: '/api/tailscale/up',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { authKey: 'tskey-auth-k1', hostname: 'sentinel', acceptDns: false }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false, needsLogin: true });
    expect(String(res.json()?.authUrl || '')).toContain('https://login.tailscale.com/');
  });

  it('POST /api/tailscale/down returns 502 on CLI failure', async () => {
    if (!dockerOk) return;

    mockState.scenario = 'down-fails';

    const res = await app.inject({ method: 'POST', url: '/api/tailscale/down', headers: { cookie } });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'TAILSCALE_DOWN_FAILED' });
  });

  it('POST /api/tailscale/config returns ok on CLI success', async () => {
    if (!dockerOk) return;

    mockState.scenario = 'config-ok';

    const res = await app.inject({
      method: 'POST',
      url: '/api/tailscale/config',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { hostname: 'sentinel', advertiseExitNode: true, advertiseRoutes: ['192.168.0.0/24'], snatSubnetRoutes: true }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });
});
