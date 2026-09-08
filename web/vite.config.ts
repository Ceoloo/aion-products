import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { builtinModules } from 'node:module';

const browserCrypto = fileURLToPath(new URL('./src/lib/browser-crypto.ts', import.meta.url));
const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')));

/** Fail closed on server dependencies, including imports Rollup could tree-shake. */
function browserBoundary(): Plugin {
  return {
    name: 'aion-browser-boundary',
    enforce: 'pre',
    resolveId(source, importer) {
      // The pinned canonical Core uses only randomUUID from node:crypto.
      // Adapt that precise import to Web Crypto; never polyfill Node wholesale.
      if (source === 'node:crypto' && importer?.replaceAll('\\', '/').endsWith('/aion-core/dist/contracts/identifiers.js')) {
        return browserCrypto;
      }
      if (source.startsWith('node:') || builtins.has(source) || source.startsWith('@anthropic-ai/sdk')) {
        this.error(`Server dependency "${source}" entered the browser graph from ${importer}`);
      }
      return null;
    },
    transform(_code, id) {
      const path = id.replaceAll('\\', '/').split('?')[0];
      if (/\/src\/(server|cli)\//.test(path) || /\/src\/platform\/(provider-adapter|ai-execution|runtime-client)\.ts$/.test(path) || /\/src\/platform\/providers\//.test(path) || /\/src\/aion\.ts$/.test(path) || /\/src\/validation\/(store|readiness)\.ts$/.test(path)) {
        this.error(`Server-only module entered the browser graph: ${path}`);
      }
      return null;
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [browserBoundary(), react()],
  base: '/',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    // Preview never proxies API requests to a real console.
    proxy: mode === 'preview' ? undefined : { '/api': { target: process.env.AION_API ?? 'http://localhost:4173', changeOrigin: true } },
  },
}));
