import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from '../../src/authPassword.js';

describe('integration: authPassword module', () => {
  it('hashPassword returns a scrypt record and verifyPassword accepts correct password', () => {
    const record = hashPassword('pw123');
    expect(record.scheme).toBe('scrypt');
    expect(record.saltB64).toBeTruthy();
    expect(record.hashB64).toBeTruthy();
    expect(record.keyLen).toBeGreaterThan(0);

    expect(verifyPassword('pw123', record)).toBe(true);
    expect(verifyPassword('wrong', record)).toBe(false);
  });

  it('verifyPassword returns false for non-scrypt records', () => {
    expect(
      verifyPassword('pw', {
        scheme: 'argon2',
        saltB64: '',
        hashB64: '',
        keyLen: 32,
        N: 1,
        r: 1,
        p: 1
      } as any)
    ).toBe(false);
  });

  it('verifyPassword returns false if derived length differs', () => {
    const record = hashPassword('pw');
    const shortened = { ...record, hashB64: Buffer.alloc(1).toString('base64') };
    expect(verifyPassword('pw', shortened as any)).toBe(false);
  });
});
