import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
      // (2026-07: actuals lines 94.6 / statements 92.1 / functions 89.8 / branches 85.6)
      thresholds: {
        lines: 92,
        statements: 90,
        functions: 87,
        branches: 83,
      },
    },
  },
})
