import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions
) => Promise<Buffer>;

export type PasswordHashRecord = {
  scheme: 'scrypt';
  saltB64: string;
  hashB64: string;
  keyLen: number;
  N: number;
  r: number;
  p: number;
};

const DEFAULT_PARAMS = {
  keyLen: 32,
  N: 16384,
  r: 8,
  p: 1
} as const;

export async function hashPassword(password: string): Promise<PasswordHashRecord> {
  const salt = crypto.randomBytes(16);
  const keyLen = DEFAULT_PARAMS.keyLen;
  const derived = await scryptAsync(password, salt, keyLen, {
    N: DEFAULT_PARAMS.N,
    r: DEFAULT_PARAMS.r,
    p: DEFAULT_PARAMS.p,
    maxmem: 64 * 1024 * 1024
  });

  return {
    scheme: 'scrypt',
    saltB64: salt.toString('base64'),
    hashB64: derived.toString('base64'),
    keyLen,
    N: DEFAULT_PARAMS.N,
    r: DEFAULT_PARAMS.r,
    p: DEFAULT_PARAMS.p
  };
}

export async function verifyPassword(password: string, record: PasswordHashRecord): Promise<boolean> {
  if (!record || record.scheme !== 'scrypt') return false;

  const salt = Buffer.from(record.saltB64, 'base64');
  const expected = Buffer.from(record.hashB64, 'base64');
  const derived = await scryptAsync(password, salt, record.keyLen, {
    N: record.N,
    r: record.r,
    p: record.p,
    maxmem: 64 * 1024 * 1024
  });

  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}
