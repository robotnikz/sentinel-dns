import crypto from 'node:crypto';
import type { AppConfig } from './config.js';

export type EncryptedPayloadV1 = {
  v: 1;
  alg: 'aes-256-gcm';
  iv: string; // base64
  tag: string; // base64
  data: string; // base64
};

function deriveKey(config: AppConfig): Buffer {
  if (!config.SECRETS_KEY) {
    throw new Error('SECRETS_KEY not configured');
  }

  // Allow either base64-encoded 32 bytes, or a passphrase.
  const maybeBase64 = config.SECRETS_KEY.trim();
  try {
    const buf = Buffer.from(maybeBase64, 'base64');
    if (buf.length === 32) return buf;
  } catch {
    // ignore
  }

  // Stable passphrase derivation.
  return crypto.scryptSync(maybeBase64, 'sentinel-dns:v1', 32);
}

export function encryptString(config: AppConfig, plaintext: string): EncryptedPayloadV1 {
  const key = deriveKey(config);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ciphertext.toString('base64')
  };
}

export function decryptString(config: AppConfig, payload: EncryptedPayloadV1): string {
  const key = deriveKey(config);

  if (payload.v !== 1 || payload.alg !== 'aes-256-gcm') {
    throw new Error('Unsupported encrypted payload');
  }

  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const data = Buffer.from(payload.data, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return plaintext.toString('utf8');
}

export function isEncryptedPayload(value: unknown): value is EncryptedPayloadV1 {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as any).v === 1 &&
    (value as any).alg === 'aes-256-gcm' &&
    typeof (value as any).iv === 'string' &&
    typeof (value as any).tag === 'string' &&
    typeof (value as any).data === 'string'
  );
}
