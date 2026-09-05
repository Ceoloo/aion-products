import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// The built app is served at site root by the AION console server, and the API
// is same-origin there. In dev, proxy /api to the local console server.
export default defineConfig({
  plugins: [react()],
  base: '/',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.AION_API ?? 'http://localhost:4173', changeOrigin: true } },
  },
});
