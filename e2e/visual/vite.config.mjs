import { fileURLToPath } from 'node:url';
import react from '../../web/node_modules/@vitejs/plugin-react/dist/index.js';

const appVersionModule = fileURLToPath(new URL('../../web/src/changelog/version.ts', import.meta.url));
const pinnedVersionModule = fileURLToPath(new URL('./pinned-version.ts', import.meta.url));

// The displayed app version is pinned like __APP_COMMIT__/__APP_COMMIT_TIME__ below: every
// import that RESOLVES to web/src/changelog/version.ts (whatever its relative specifier) gets
// pinned-version.ts instead, so a release bump never touches the baselines.
const pinAppVersion = {
  name: 'lettuce-visual-pin-app-version',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === appVersionModule ? pinnedVersionModule : null;
  },
};

// Independent build: never load web/vite.config.ts (its dev proxy targets :8080),
// write web/dist, or use the shared Vite dependency cache.
export default {
  configFile: false,
  root: fileURLToPath(new URL('../../web/', import.meta.url)),
  envDir: false,
  cacheDir: fileURLToPath(new URL('./.cache/', import.meta.url)),
  plugins: [pinAppVersion, react()],
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
