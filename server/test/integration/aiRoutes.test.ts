import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { extractSessionCookie, hasDocker, startPostgresContainer, startTestApp } from './_harness.js';

type FetchType = typeof fetch;

describe('integration: AI routes (no WAN)', () => {
  let dockerOk = false;
  let pg: Awaited<ReturnType<typeof startPostgresContainer>> | null = null;
  let closeApp: (() => Promise<void>) | null = null;
  let app: any;
  let cookie = '';
  let pool: Pool | null = null;
  let baseFetch: FetchType | null = null;

  beforeAll(async () => {
    dockerOk = await hasDocker();
    if (!dockerOk) return;

    pg = await startPostgresContainer();
    pool = new Pool({ connectionString: pg.databaseUrl });

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

    // Do NOT wipe the whole settings table here: it would remove auth/session state created by setup.
    // Only clear AI secrets used by these tests.
    await pool.query("DELETE FROM settings WHERE key LIKE 'secret:%'");

    baseFetch = globalThis.fetch;
  }, 120_000);

  afterEach(() => {
    if (baseFetch) globalThis.fetch = baseFetch;
  });

  afterAll(async () => {
    if (baseFetch) globalThis.fetch = baseFetch;
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

  it('GET /api/ai/status returns providers flags', async () => {
    if (!dockerOk || !pool) return;

    const res1 = await app.inject({ method: 'GET', url: '/api/ai/status', headers: { cookie } });
    expect(res1.statusCode).toBe(200);
    expect(res1.json()).toHaveProperty('providers');

    // Seed a plaintext OpenAI key (backward compatible) and ensure status reflects it.
    await pool.query(
      'INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
      ['secret:openai_api_key', JSON.stringify('sk-test')]
    );

    const res2 = await app.inject({ method: 'GET', url: '/api/ai/status', headers: { cookie } });
    expect(res2.statusCode).toBe(200);
    expect(res2.json()?.providers?.openai).toBe(true);
  });

  it('POST /api/ai/analyze-domain returns AI_NOT_CONFIGURED when key missing', async () => {
    if (!dockerOk || !pool) return;

    await pool.query("DELETE FROM settings WHERE key LIKE 'secret:%'");

    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/analyze-domain',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { domain: 'example.com', provider: 'openai' }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ error: 'AI_NOT_CONFIGURED' });
  });

  it('POST /api/ai/analyze-domain (openai) handles non-OK and OK responses via mocked fetch', async () => {
    if (!dockerOk || !pool) return;

    await pool.query(
      'INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
      ['secret:openai_api_key', JSON.stringify('sk-test')]
    );

    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : typeof input?.url === 'string' ? input.url : '';
      if (url === 'https://api.openai.com/v1/chat/completions') {
        return new Response('nope', { status: 500 });
      }
      return (baseFetch as FetchType)(input, init);
    }) as FetchType;

    const failed = await app.inject({
      method: 'POST',
      url: '/api/ai/analyze-domain',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { domain: 'example.com', provider: 'openai' }
    });

    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toMatchObject({ error: 'AI_FAILED' });

    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : typeof input?.url === 'string' ? input.url : '';
      if (url === 'https://api.openai.com/v1/chat/completions') {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return (baseFetch as FetchType)(input, init);
    }) as FetchType;

    const ok = await app.inject({
      method: 'POST',
      url: '/api/ai/analyze-domain',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { domain: 'example.com', provider: 'openai' }
    });

    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ text: 'OK' });
  });
});
