import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/authPassword.js';

describe('authPassword', () => {
  it('verifies the correct password', async () => {
    const record = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', record)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const record = await hashPassword('secret');
    expect(await verifyPassword('not-secret', record)).toBe(false);
  });

  it('rejects records with wrong scheme', async () => {
    const record: any = await hashPassword('secret');
    record.scheme = 'unknown';
    expect(await verifyPassword('secret', record)).toBe(false);
  });
});
