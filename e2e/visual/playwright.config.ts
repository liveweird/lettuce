import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const canonical = process.env.VISUAL_CANONICAL === '1' && process.platform === 'linux' && process.arch === 'x64';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 30_000,
  updateSnapshots: 'none',
  snapshotPathTemplate: canonical
    ? '{testDir}/../snapshots/{testFilePath}/{arg}{ext}'
    : '{testDir}/../diagnostic-snapshots/{platform}/{testFilePath}/{arg}{ext}',
  outputDir: './test-results',
  reporter: [['list'], ['html', { outputFolder: `${here}playwright-report`, open: 'never' }]],
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixels: 0 },
  },
  use: {
    browserName: 'chromium',
    baseURL: 'http://127.0.0.1:5197',
    viewport: { width: 1280, height: 1000 },
    deviceScaleFactor: 1,
    locale: 'en-GB',
    timezoneId: 'Europe/Warsaw',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node serve.mjs',
    cwd: here,
    url: 'http://127.0.0.1:5197',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
