import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { extractSessionCookie, hasDocker, startPostgresContainer, startTestApp } from './_harness.js';

describe('integration: secrets storage requires SECRETS_KEY', () => {
  let dockerOk = false;
  let pg: Awaited<ReturnType<typeof startPostgresContainer>> | null = null;
  let closeApp: (() => Promise<void>) | null = null;
  let app: any;
  let cookie = '';
  let prevSecretsKey: string | undefined;

  beforeAll(async () => {
    prevSecretsKey = process.env.SECRETS_KEY;
    process.env.SECRETS_KEY = '';

    dockerOk = await hasDocker();
    if (!dockerOk) return;

    pg = await startPostgresContainer();
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
  }, 120_000);

  afterAll(async () => {
    try {
      await closeApp?.();
    } catch {
      // ignore
    }
    await pg?.stop().catch(() => undefined);

    if (prevSecretsKey === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = prevSecretsKey;
  }, 120_000);

  it('skips if Docker is unavailable', async () => {
    if (!dockerOk) {
      expect(dockerOk).toBe(false);
      return;
    }
    expect(dockerOk).toBe(true);
  });

  it('PUT /api/secrets/:name fails with SECRETS_KEY_MISSING when not configured', async () => {
    if (!dockerOk) return;

    const res = await app.inject({
      method: 'PUT',
      url: '/api/secrets/gemini_api_key',
      headers: { cookie },
      payload: { value: 'test-secret' }
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({
      error: 'SECRETS_KEY_MISSING'
    });
  });
});
