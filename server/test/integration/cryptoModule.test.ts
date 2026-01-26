import { describe, expect, it } from 'vitest';

import { decryptString, encryptString, isEncryptedPayload } from '../../src/crypto.js';

describe('integration: crypto module (encrypt/decrypt)', () => {
  it('round-trips plaintext using a base64 32-byte SECRETS_KEY', () => {
    const config = {
      SECRETS_KEY: Buffer.alloc(32, 7).toString('base64')
    } as any;

    const payload = encryptString(config, 'hello');
    expect(payload.v).toBe(1);
    expect(payload.alg).toBe('aes-256-gcm');
    expect(isEncryptedPayload(payload)).toBe(true);

    const out = decryptString(config, payload);
    expect(out).toBe('hello');
  });

  it('round-trips plaintext using passphrase-derived SECRETS_KEY', () => {
    const config = { SECRETS_KEY: 'correct horse battery staple' } as any;
    const payload = encryptString(config, 'secret');
    const out = decryptString(config, payload);
    expect(out).toBe('secret');
  });

  it('throws when SECRETS_KEY is missing', () => {
    const config = {} as any;
    expect(() => encryptString(config, 'x')).toThrow(/SECRETS_KEY not configured/i);
  });

  it('rejects unsupported payload versions/algorithms', () => {
    const config = { SECRETS_KEY: Buffer.alloc(32, 1).toString('base64') } as any;

    expect(() =>
      decryptString(config, {
        v: 2,
        alg: 'aes-256-gcm',
        iv: 'AA==',
        tag: 'AA==',
        data: 'AA=='
      } as any)
    ).toThrow(/Unsupported encrypted payload/i);

    expect(() =>
      decryptString(config, {
        v: 1,
        alg: 'aes-256-cbc',
        iv: 'AA==',
        tag: 'AA==',
        data: 'AA=='
      } as any)
    ).toThrow(/Unsupported encrypted payload/i);
  });

  it('fails authentication if tag is modified', () => {
    const config = { SECRETS_KEY: Buffer.alloc(32, 2).toString('base64') } as any;

    const payload = encryptString(config, 'hello');
    const tagBuf = Buffer.from(payload.tag, 'base64');
    tagBuf[0] = tagBuf[0] ^ 0xff;
    const tampered = { ...payload, tag: tagBuf.toString('base64') };

    expect(() => decryptString(config, tampered as any)).toThrow();
  });

  it('isEncryptedPayload returns false for non-matching shapes', () => {
    expect(isEncryptedPayload(null)).toBe(false);
    expect(isEncryptedPayload({})).toBe(false);
    expect(isEncryptedPayload({ v: 1, alg: 'aes-256-gcm' })).toBe(false);
  });
});
