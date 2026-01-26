import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/authPassword.js';

describe('authPassword', () => {
  it('verifies the correct password', () => {
    const record = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', record)).toBe(true);
  });

  it('rejects an incorrect password', () => {
    const record = hashPassword('secret');
    expect(verifyPassword('not-secret', record)).toBe(false);
  });

  it('rejects records with wrong scheme', () => {
    const record: any = hashPassword('secret');
    record.scheme = 'unknown';
    expect(verifyPassword('secret', record)).toBe(false);
  });
});
