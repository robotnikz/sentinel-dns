import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function tryReadText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

function writeText0600(filePath: string, value: string): void {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, `${value}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort; ignore if FS doesn't support chmod
  }
}

function randomTokenBase64Url(bytes: number): string {
  const buf = crypto.randomBytes(bytes);
  // base64url without padding
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export type PersistedSecrets = {
  adminToken: string;
  secretsKey: string;
  createdAdminToken: boolean;
  createdSecretsKey: boolean;
};

export function loadOrCreatePersistedSecrets(opts: {
  dataDir: string;
  envAdminToken?: string;
  envSecretsKey?: string;
}): PersistedSecrets {
  const configDir = path.join(opts.dataDir, 'sentinel');
  ensureDir(configDir);

  const adminTokenPath = path.join(configDir, 'admin_token');
  const secretsKeyPath = path.join(configDir, 'secrets_key');

  const existingAdminToken = tryReadText(adminTokenPath);
  const existingSecretsKey = tryReadText(secretsKeyPath);

  const envAdminToken = (opts.envAdminToken || '').trim();
  const envSecretsKey = (opts.envSecretsKey || '').trim();

  let adminToken = envAdminToken || existingAdminToken;
  let secretsKey = envSecretsKey || existingSecretsKey;
  let createdAdminToken = false;
  let createdSecretsKey = false;

  if (!adminToken) {
    adminToken = randomTokenBase64Url(24);
    writeText0600(adminTokenPath, adminToken);
    createdAdminToken = true;
  } else if (!existingAdminToken) {
    // Persist env-provided token on first run for future restarts.
    writeText0600(adminTokenPath, adminToken);
  }

  if (!secretsKey) {
    // 32 bytes, base64 encoded => supported by our crypto helper.
    secretsKey = crypto.randomBytes(32).toString('base64');
    writeText0600(secretsKeyPath, secretsKey);
    createdSecretsKey = true;
  } else if (!existingSecretsKey) {
    writeText0600(secretsKeyPath, secretsKey);
  }

  return { adminToken, secretsKey, createdAdminToken, createdSecretsKey };
}
