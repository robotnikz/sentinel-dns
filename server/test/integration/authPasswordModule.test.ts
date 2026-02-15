import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from '../../src/authPassword.js';

describe('integration: authPassword module', () => {
  it('hashPassword returns a scrypt record and verifyPassword accepts correct password', async () => {
    const record = await hashPassword('pw123');
    expect(record.scheme).toBe('scrypt');
    expect(record.saltB64).toBeTruthy();
    expect(record.hashB64).toBeTruthy();
    expect(record.keyLen).toBeGreaterThan(0);

    expect(await verifyPassword('pw123', record)).toBe(true);
    expect(await verifyPassword('wrong', record)).toBe(false);
  });

  it('verifyPassword returns false for non-scrypt records', async () => {
    expect(
      await verifyPassword('pw', {
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

  it('verifyPassword returns false if derived length differs', async () => {
    const record = await hashPassword('pw');
    const shortened = { ...record, hashB64: Buffer.alloc(1).toString('base64') };
    expect(await verifyPassword('pw', shortened as any)).toBe(false);
  });
});
