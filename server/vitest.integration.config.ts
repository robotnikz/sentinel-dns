import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    // Docker-based tests can be slow on CI/Windows.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Running multiple dockerized Postgres containers in parallel is flaky on some CI/Windows
    // runners (containers can get OOM-killed, causing sporadic "Connection terminated" errors).
    minWorkers: 1,
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage/integration',
      all: true,
      include: ['src/**/*.ts'],
      exclude: ['**/*.d.ts', 'dist/**', 'test/**']
    }
  }
});
