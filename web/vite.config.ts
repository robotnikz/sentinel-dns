import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const repoRoot = path.resolve(__dirname, '..');
    const env = loadEnv(mode, repoRoot, '');
    return {
      root: __dirname,
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/api': {
            target: env.VITE_API_PROXY_TARGET || 'http://localhost:8080',
            changeOrigin: true
          }
        }
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, 'src'),
        }
      },
      build: {
        outDir: path.resolve(repoRoot, 'dist'),
        emptyOutDir: true
      }
    };
});
