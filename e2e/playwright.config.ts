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
  // 60s: the old 180s existed only to feed the login helper's per-IP rate-limit retry ladder,
  // which could eat ~90s on its own. Development stacks now lift that bucket and the seeded
  // accounts replay a minted session instead of signing in (global-setup.ts / sessions.ts), so
  // the slowest test is genuine UI work (teams, ~32s) — 60s leaves headroom while letting a
  // broken run fail three times faster.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  use: {
    baseURL: BASE_URL,
    // retain-on-failure, not on-first-retry: retries are 0 locally, so on-first-retry never
    // fired and local failures produced no trace at all. A trace beats the video it replaces
    // (DOM snapshots, network, console) and costs nothing on a passing run.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
