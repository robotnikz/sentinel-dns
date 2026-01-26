import { describe, expect, it } from 'vitest';
import { decryptString, encryptString, isEncryptedPayload } from '../../src/crypto.js';

function cfg(secretsKey: string) {
  // Minimal AppConfig shape for crypto helpers.
  return {
    SECRETS_KEY: secretsKey
  } as any;
}

describe('crypto', () => {
  it('round-trips with a passphrase secrets key', () => {
    const config = cfg('my passphrase');
    const enc = encryptString(config, 'hello');
    expect(isEncryptedPayload(enc)).toBe(true);
    expect(decryptString(config, enc)).toBe('hello');
  });

  it('round-trips with a base64 32-byte secrets key', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const config = cfg(key);
    const enc = encryptString(config, 'hello');
    expect(decryptString(config, enc)).toBe('hello');
  });

  it('throws when SECRETS_KEY is missing', () => {
    expect(() => encryptString(cfg(''), 'x')).toThrow(/SECRETS_KEY/);
  });
});
