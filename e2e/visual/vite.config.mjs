import { fileURLToPath } from 'node:url';
import react from '../../web/node_modules/@vitejs/plugin-react/dist/index.js';

// Independent build: never load web/vite.config.ts (its dev proxy targets :8080),
// write web/dist, or use the shared Vite dependency cache.
export default {
  configFile: false,
  root: fileURLToPath(new URL('../../web/', import.meta.url)),
  envFile: false,
  cacheDir: fileURLToPath(new URL('./.cache/', import.meta.url)),
  plugins: [react()],
  define: {
    __APP_COMMIT__: JSON.stringify('visual-fixture'),
    __APP_COMMIT_TIME__: JSON.stringify('2026-10-01T12:00:00Z'),
    'import.meta.env.VITE_API_BASE': JSON.stringify(''),
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/', import.meta.url)),
    emptyOutDir: true,
  },
  preview: { host: '127.0.0.1', port: 5197, strictPort: true },
};
