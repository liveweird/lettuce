import { defineConfig, devices } from "@playwright/test";

// Blackbox E2E: drives a real browser against the full stack (SPA + server + Postgres) served
// single-origin at http://localhost:8080 by `docker compose`. The stack is brought up/down by
// global-setup / global-teardown (unless one is already running locally, which is reused).
export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8080";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false, // the specs share one seeded database; keep them serial and deterministic
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  // Generous per-test budget: the login helper may wait out the server's per-IP login
  // rate limit (10/min) between retries — see helpers.ts.
  timeout: 120_000,
  expect: { timeout: 10_000 },
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
