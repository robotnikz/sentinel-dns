import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadOrCreatePersistedSecrets } from '../../src/persistedConfig.js';

function mkTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-it-'));
}

describe('integration: persistedConfig module', () => {
  it('creates admin_token and secrets_key when none exist', () => {
    const dataDir = mkTempDir();
    try {
      const res = loadOrCreatePersistedSecrets({ dataDir });

      expect(res.adminToken).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(res.secretsKey).toBeTruthy();
      expect(res.createdAdminToken).toBe(true);
      expect(res.createdSecretsKey).toBe(true);

      const tokenPath = path.join(dataDir, 'sentinel', 'admin_token');
      const keyPath = path.join(dataDir, 'sentinel', 'secrets_key');

      expect(fs.existsSync(tokenPath)).toBe(true);
      expect(fs.existsSync(keyPath)).toBe(true);

      expect(fs.readFileSync(tokenPath, 'utf8').trim()).toBe(res.adminToken);
      expect(fs.readFileSync(keyPath, 'utf8').trim()).toBe(res.secretsKey);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('persists env-provided values on first run when files are missing', () => {
    const dataDir = mkTempDir();
    try {
      const res = loadOrCreatePersistedSecrets({
        dataDir,
        envAdminToken: 'env-admin',
        envSecretsKey: Buffer.alloc(32, 9).toString('base64')
      });

      expect(res.adminToken).toBe('env-admin');
      expect(res.secretsKey).toBe(Buffer.alloc(32, 9).toString('base64'));
      expect(res.createdAdminToken).toBe(false);
      expect(res.createdSecretsKey).toBe(false);

      const tokenPath = path.join(dataDir, 'sentinel', 'admin_token');
      const keyPath = path.join(dataDir, 'sentinel', 'secrets_key');

      expect(fs.readFileSync(tokenPath, 'utf8').trim()).toBe('env-admin');
      expect(fs.readFileSync(keyPath, 'utf8').trim()).toBe(Buffer.alloc(32, 9).toString('base64'));
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('reuses existing files and does not report creation', () => {
    const dataDir = mkTempDir();
    try {
      const configDir = path.join(dataDir, 'sentinel');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'admin_token'), 'existing-token\n', 'utf8');
      fs.writeFileSync(path.join(configDir, 'secrets_key'), 'existing-key\n', 'utf8');

      const res = loadOrCreatePersistedSecrets({ dataDir });
      expect(res.adminToken).toBe('existing-token');
      expect(res.secretsKey).toBe('existing-key');
      expect(res.createdAdminToken).toBe(false);
      expect(res.createdSecretsKey).toBe(false);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('prefers env values over existing files', () => {
    const dataDir = mkTempDir();
    try {
      const configDir = path.join(dataDir, 'sentinel');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'admin_token'), 'existing-token\n', 'utf8');
      fs.writeFileSync(path.join(configDir, 'secrets_key'), 'existing-key\n', 'utf8');

      const res = loadOrCreatePersistedSecrets({
        dataDir,
        envAdminToken: 'env-token',
        envSecretsKey: 'env-key'
      });

      expect(res.adminToken).toBe('env-token');
      expect(res.secretsKey).toBe('env-key');
      expect(res.createdAdminToken).toBe(false);
      expect(res.createdSecretsKey).toBe(false);

      // Existing files are kept as-is (we only persist env values when missing).
      expect(fs.readFileSync(path.join(configDir, 'admin_token'), 'utf8').trim()).toBe('existing-token');
      expect(fs.readFileSync(path.join(configDir, 'secrets_key'), 'utf8').trim()).toBe('existing-key');
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
