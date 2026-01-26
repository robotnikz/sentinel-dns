import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/test/**/*.test.{ts,tsx}'],
    exclude: ['../server/**', '../tests/e2e/**', '../node_modules/**', '../dist/**'],
    setupFiles: [path.resolve(__dirname, 'src/test/setup.ts')],
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: path.resolve(__dirname, '../coverage/frontend'),
      all: true,
      include: ['src/components/**/*.{ts,tsx}', 'src/contexts/**/*.{ts,tsx}', 'src/services/**/*.{ts,tsx}'],
      exclude: ['src/test/**', '**/*.d.ts']
    }
  }
});
