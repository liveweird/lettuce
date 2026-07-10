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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_COMMIT_TIME__: JSON.stringify(commitTime),
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
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
      // (2026-07-11: actuals lines 97.3 / statements 94.5 / functions 90.4 / branches 88.6)
      thresholds: {
        lines: 93,
        statements: 91,
        functions: 88,
        branches: 84,
      },
    },
  },
})
