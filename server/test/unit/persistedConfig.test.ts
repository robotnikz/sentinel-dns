import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadOrCreatePersistedSecrets } from '../../src/persistedConfig.js';

async function mkTmpDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'sentinel-dns-test-'));
}

describe('persistedConfig', () => {
  it('creates admin token + secrets key on first run', async () => {
    const dir = await mkTmpDir();

    const res = loadOrCreatePersistedSecrets({ dataDir: dir });
    expect(res.adminToken).toBeTruthy();
    expect(res.secretsKey).toBeTruthy();
    expect(res.createdAdminToken).toBe(true);
    expect(res.createdSecretsKey).toBe(true);

    const adminTokenPath = path.join(dir, 'sentinel', 'admin_token');
    const secretsKeyPath = path.join(dir, 'sentinel', 'secrets_key');

    expect((await fs.readFile(adminTokenPath, 'utf8')).trim()).toBe(res.adminToken);
    expect((await fs.readFile(secretsKeyPath, 'utf8')).trim()).toBe(res.secretsKey);
  });

  it('reuses previously persisted values', async () => {
    const dir = await mkTmpDir();

    const first = loadOrCreatePersistedSecrets({ dataDir: dir });
    const second = loadOrCreatePersistedSecrets({ dataDir: dir });

    expect(second.adminToken).toBe(first.adminToken);
    expect(second.secretsKey).toBe(first.secretsKey);
    expect(second.createdAdminToken).toBe(false);
    expect(second.createdSecretsKey).toBe(false);
  });

  it('persists env-provided values when files are missing', async () => {
    const dir = await mkTmpDir();

    const adminToken = 'admin-token-from-env';
    const secretsKey = Buffer.alloc(32, 9).toString('base64');

    const res = loadOrCreatePersistedSecrets({ dataDir: dir, envAdminToken: adminToken, envSecretsKey: secretsKey });

    expect(res.adminToken).toBe(adminToken);
    expect(res.secretsKey).toBe(secretsKey);
    expect(res.createdAdminToken).toBe(false);
    expect(res.createdSecretsKey).toBe(false);

    const adminTokenPath = path.join(dir, 'sentinel', 'admin_token');
    const secretsKeyPath = path.join(dir, 'sentinel', 'secrets_key');

    expect((await fs.readFile(adminTokenPath, 'utf8')).trim()).toBe(adminToken);
    expect((await fs.readFile(secretsKeyPath, 'utf8')).trim()).toBe(secretsKey);
  });
});
