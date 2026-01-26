import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage/unit',
      all: true,
      include: ['src/**/*.ts'],
      exclude: ['**/*.d.ts', 'dist/**', 'test/**']
    }
  }
});
