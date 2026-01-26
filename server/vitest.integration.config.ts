import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    // Docker-based tests can be slow on CI/Windows.
    testTimeout: 120_000,
    hookTimeout: 120_000,
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
