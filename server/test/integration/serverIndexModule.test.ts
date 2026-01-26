import { describe, expect, it, vi } from 'vitest';

describe('integration: server src/index.ts entrypoint', () => {
  it('loads config, builds app, and listens on HOST/PORT', async () => {
    vi.resetModules();

    const listen = vi.fn().mockResolvedValue(undefined);

    vi.doMock('../../src/config.js', () => ({
      loadConfig: () => ({ HOST: '127.0.0.1', PORT: 54321 })
    }));

    vi.doMock('../../src/app.js', () => ({
      buildApp: async () => ({ app: { listen } })
    }));

    await import('../../src/index.js');

    expect(listen).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith({ host: '127.0.0.1', port: 54321 });
  });

  it('logs and exits(1) when startup fails', async () => {
    vi.resetModules();

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as unknown as (code?: number) => never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    vi.doMock('../../src/config.js', () => ({
      loadConfig: () => ({ HOST: '127.0.0.1', PORT: 1 })
    }));

    vi.doMock('../../src/app.js', () => ({
      buildApp: async () => {
        throw new Error('boom');
      }
    }));

    await import('../../src/index.js');
    await new Promise((r) => setTimeout(r, 0));

    expect(errorSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
