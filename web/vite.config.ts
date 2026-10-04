import { execSync } from 'node:child_process'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

function git(args: string): string {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

// Build stamp shown by src/components/VersionStamp.tsx. Env vars win so the Docker
// build (whose worktree never matches the index — a `git status` dirty check there
// would always be a false positive) and CI can inject exact values; local builds
// fall back to git, marking uncommitted state with "+dirty".
const sha = git('rev-parse --short HEAD')
const commit =
  process.env.GIT_SHA || (sha ? (git('status --porcelain') ? `${sha}+dirty` : sha) : 'unknown')
const commitTime = process.env.GIT_COMMIT_TIME || git('log -1 --format=%cI') || ''

// Where the dev server proxies the API. Defaults to the local `:server:run` (8080); VITE_API_TARGET lets the front-end
// profiling recipe (a dev build + React DevTools Profiler against the perf stack, .claude/docs/performance.md) point at
// http://localhost:18080 without editing this file.
const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:8080'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_COMMIT_TIME__: JSON.stringify(commitTime),
  },
  server: {
    // Vitest only: notificationPreferenceLabels.test.ts reads the OpenAPI spec (outside web/) as
    // `?raw` to pin the label map against the NotificationType enum. The dev server stays
    // confined to web/.
    ...(process.env.VITEST ? { fs: { allow: ['.', '../server/src/main/resources/openapi'] } } : {}),
    proxy: {
      '/api': apiTarget,
      // The integration GraphQL endpoint lives outside /api (see the integration-api doc); the
      // e2e integration-clients spec calls it through the SPA origin in the SPA-only posture.
      // Anchored: a bare '/integration' prefix would also swallow the SPA route /integration-clients.
      '^/integration/': apiTarget,
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // Groups capture their transitive deps too, so without this higher-priority group
            // React itself (a dep of @lexical/react) would land inside the lexical chunk and
            // every other chunk would import it eagerly, defeating the lazy editor split.
            {
              name: 'react',
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              priority: 10,
            },
            // MDXEditor's Lexical engine — roughly half of the (lazy-loaded) editor payload.
            // Splitting it keeps every chunk under Vite's 500 kB warning threshold; both
            // halves load in parallel behind the same dynamic import.
            { name: 'lexical', test: /node_modules[\\/](?:@lexical|lexical)[\\/]/, priority: 5 },
            // The emoji-mart data set — the bulk of the (lazy-loaded) picker payload; the
            // same under-500 kB split as the lexical group above.
            { name: 'emoji-data', test: /node_modules[\\/]@emoji-mart[\\/]data[\\/]/, priority: 5 },
            // dayjs CORE stays its own chunk: `dayjs/locale/<lang>.js` `require`s it, and a language group
            // pulls its dependencies in recursively — without this, dayjs core landed inside `i18n-pl` and
            // every date field (English users too) statically imported the Polish chunk.
            { name: 'dayjs', test: /node_modules[\\/]dayjs[\\/]dayjs\.min\.js/, priority: 30 },
            // One chunk per non-EN language (v4.15.1): its ~29 locale JSON files plus its dayjs calendar
            // locale, which are only ever reached through `loadLanguage`'s dynamic imports — without this
            // a language switch/first paint fetched ~31 files. The group name is derived from the module
            // path (`i18n-<lang>`), so a new shipped language needs no config edit. EN stays in `i18n`.
            {
              name: (id: string) => {
                const m = /src[\\/]locales[\\/](?!en[\\/])([^\\/]+)[\\/]|node_modules[\\/]dayjs[\\/]locale[\\/](?!en\.)([^\\/.]+)\.js/.exec(id);
                const lang = m?.[1] ?? m?.[2];
                return lang ? `i18n-${lang}` : null;
              },
              priority: 20,
            },
            // ONE chunk for the initial graph (v4.15.1): rolldown's built-in `$initial` tag matches
            // every module statically reachable from the entry, so the ~25 per-module shared
            // chunks the entry used to fan out into (34 `modulepreload`s) collapse into a single
            // `vendor` file; vendor modules only a lazy page reaches stay in that page's chunk.
            // `react` keeps its higher priority so a Mantine bump does not invalidate the cached
            // React chunk. (The former `dates` group is gone: its forced single chunk became
            // initial through `DatesProvider` and dragged the whole calendar layer in.)
            { name: 'vendor', test: /node_modules[\\/]/, tags: ['$initial'], priority: 1 },
          ],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/api/schema.ts',
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
        '**/*.d.ts',
      ],
      // Floors set just below current measured coverage so they gate regressions without
      // blocking unrelated work. Raise as coverage improves.
      // (2026-10-03: actuals lines 95.91 / statements 93.31 / functions 91.17 / branches 89.76)
      thresholds: {
        lines: 94,
        statements: 92,
        functions: 89,
        branches: 87,
      },
    },
  },
})
