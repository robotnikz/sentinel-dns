import { describe, expect, it, vi } from 'vitest';
import { encryptString } from '../../src/crypto.js';
import { getSecret } from '../../src/secretsStore.js';

function cfg(secretsKey: string) {
  // Minimal AppConfig shape for crypto helpers.
  return { SECRETS_KEY: secretsKey } as any;
}

describe('secretsStore.getSecret', () => {
  it('returns empty string when setting is missing', async () => {
    const db = { pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } } as any;
    const val = await getSecret(db, cfg('passphrase'), 'x');
    expect(val).toBe('');
  });

  it('returns plaintext for backward compatibility', async () => {
    const db = { pool: { query: vi.fn().mockResolvedValue({ rows: [{ value: 'plain' }] }) } } as any;
    const val = await getSecret(db, cfg('passphrase'), 'x');
    expect(val).toBe('plain');
  });

  it('decrypts encrypted payloads', async () => {
    const config = cfg('my passphrase');
    const encrypted = encryptString(config, 'hello');
    const db = { pool: { query: vi.fn().mockResolvedValue({ rows: [{ value: encrypted }] }) } } as any;

    const val = await getSecret(db, config, 'x');
    expect(val).toBe('hello');
  });

  it('returns empty string for invalid payloads or decrypt failures', async () => {
    const config = cfg('my passphrase');

    const bad = { v: 1, alg: 'aes-256-gcm', iv: 'x', tag: 'y', data: 'z' };
    const db = { pool: { query: vi.fn().mockResolvedValue({ rows: [{ value: bad }] }) } } as any;

    const val = await getSecret(db, config, 'x');
    expect(val).toBe('');
  });
});
