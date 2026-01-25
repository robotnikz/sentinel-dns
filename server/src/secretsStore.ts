import type { Db } from './db.js';
import type { AppConfig } from './config.js';
import { decryptString, encryptString, isEncryptedPayload } from './crypto.js';

const PREFIX = 'secret:';

export async function setSecret(db: Db, config: AppConfig, name: string, value: string): Promise<void> {
  const key = `${PREFIX}${name}`;
  const encrypted = encryptString(config, value);

  await db.pool.query(
    'INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
    [key, encrypted]
  );
}

export async function getSecret(db: Db, config: AppConfig, name: string): Promise<string> {
  const key = `${PREFIX}${name}`;
  const res = await db.pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  const value = res.rows?.[0]?.value;

  if (!value) return '';

  if (typeof value === 'string') {
    // Backward compatibility if something stored plaintext.
    return value;
  }

  if (!isEncryptedPayload(value)) {
    return '';
  }

  try {
    return decryptString(config, value);
  } catch {
    return '';
  }
}

export async function hasSecret(db: Db, name: string): Promise<boolean> {
  const key = `${PREFIX}${name}`;
  const res = await db.pool.query('SELECT 1 FROM settings WHERE key = $1', [key]);
  return (res.rowCount ?? 0) > 0;
}
