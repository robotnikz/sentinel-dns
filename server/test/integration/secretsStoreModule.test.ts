import { describe, expect, it } from 'vitest';

import { getSecret, hasSecret, setSecret } from '../../src/secretsStore.js';

type Row = { value?: unknown };

describe('integration: secretsStore module (in-memory db)', () => {
  it('setSecret stores encrypted payload and getSecret decrypts it', async () => {
    const store = new Map<string, unknown>();

    const db = {
      pool: {
        query: async (sql: string, params: unknown[]) => {
          const key = String(params[0]);
          if (sql.startsWith('INSERT INTO settings')) {
            store.set(key, params[1]);
            return { rowCount: 1, rows: [] };
          }
          if (sql.startsWith('SELECT value FROM settings')) {
            const value = store.get(key);
            return { rowCount: value ? 1 : 0, rows: value ? ([{ value }] as Row[]) : ([] as Row[]) };
          }
          if (sql.startsWith('SELECT 1 FROM settings')) {
            return { rowCount: store.has(key) ? 1 : 0, rows: [] };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        }
      }
    } as any;

    const config = { SECRETS_KEY: Buffer.alloc(32, 3).toString('base64') } as any;

    await setSecret(db, config, 'gemini', 'abc123');
    expect(await hasSecret(db, 'gemini')).toBe(true);

    const out = await getSecret(db, config, 'gemini');
    expect(out).toBe('abc123');
  });

  it('getSecret returns plaintext if a string is stored (backward compatibility)', async () => {
    const store = new Map<string, unknown>();
    store.set('secret:plain', 'hello');

    const db = {
      pool: {
        query: async (_sql: string, params: unknown[]) => {
          const key = String(params[0]);
          return { rowCount: store.has(key) ? 1 : 0, rows: store.has(key) ? [{ value: store.get(key) }] : [] };
        }
      }
    } as any;

    const config = { SECRETS_KEY: Buffer.alloc(32, 4).toString('base64') } as any;
    expect(await getSecret(db, config, 'plain')).toBe('hello');
  });

  it('getSecret returns empty string for invalid shapes or failed decrypt', async () => {
    const store = new Map<string, unknown>();
    store.set('secret:badshape', { hello: 'world' });

    const db = {
      pool: {
        query: async (_sql: string, params: unknown[]) => {
          const key = String(params[0]);
          return { rowCount: store.has(key) ? 1 : 0, rows: store.has(key) ? [{ value: store.get(key) }] : [] };
        }
      }
    } as any;

    const config = { SECRETS_KEY: Buffer.alloc(32, 5).toString('base64') } as any;
    expect(await getSecret(db, config, 'badshape')).toBe('');

    // Decrypt failure: store valid payload encrypted under a different key.
    const otherConfig = { SECRETS_KEY: Buffer.alloc(32, 6).toString('base64') } as any;
    await setSecret(db, otherConfig, 'wrongkey', 'secret');
    expect(await getSecret(db, config, 'wrongkey')).toBe('');
  });

  it('hasSecret is false when key missing', async () => {
    const db = {
      pool: {
        query: async () => ({ rowCount: 0, rows: [] })
      }
    } as any;

    expect(await hasSecret(db, 'nope')).toBe(false);
  });
});
