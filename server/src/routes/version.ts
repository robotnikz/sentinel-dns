import type { FastifyInstance } from 'fastify';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const readAppVersion = (): string => {
  const envVersion = String(process.env.SENTINEL_VERSION || '').trim();
  if (envVersion) return envVersion;

  try {
    const pkg = require('../../../package.json') as { version?: string };
    const v = String(pkg?.version || '').trim();
    return v || '0.0.0';
  } catch {
    return '0.0.0';
  }
};

export async function registerVersionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/version', async () => {
    return { version: readAppVersion() };
  });
}
