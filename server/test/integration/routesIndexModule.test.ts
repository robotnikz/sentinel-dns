import { describe, expect, it } from 'vitest';

describe('integration: routes/index re-exports', () => {
  it('exports route registration helpers', async () => {
    const routes = await import('../../src/routes/index.js');
    expect(typeof routes.registerHealthRoutes).toBe('function');
    expect(typeof routes.registerAiRoutes).toBe('function');
    expect(typeof routes.registerRulesRoutes).toBe('function');
    expect(typeof routes.registerSettingsRoutes).toBe('function');
    expect(typeof routes.registerSecretsRoutes).toBe('function');
  });
});
