import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      // Shared rules/layout data lives with the authoritative server.
      '@game': resolve(__dirname, '../server/src/game'),
    },
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
  },
  build: {
    // The Colyseus server serves this folder, so the page and WSS share one origin.
    outDir: resolve(__dirname, '../server/public'),
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        host: resolve(__dirname, 'host.html'),
      },
    },
  },
});
