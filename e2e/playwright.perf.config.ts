import { defineConfig, devices } from "@playwright/test";
import { PERF_BASE_URL } from "./perf/env";

// The front-end performance runner (.claude/docs/performance.md, "Front end"): real Chromium timings of the SPA against the
// PERF stack (perf/run.sh up|restore) — `npm run perf`, or `perf/run.sh web <screen>`.
//
// Deliberately NOT derived from playwright.config.ts: NO globalSetup / globalTeardown. The e2e global-setup would
// `docker compose up -d --build` the DEV project when its target is down (the standing-rule trap) and sweeps residue; this
// runner never starts anything. Instead the `perfTarget` worker fixture (perf/harness.ts) fails fast unless PERF_BASE_URL
// (default http://localhost:18080, the perf stack) is a local address that answers /readyz.
//
// workers 1 and retries 0: concurrent browsers would contend on the measured CPU, and a retried test would hide a flake that
// is itself a measurement problem. The specs live in ./perf (NOT ./tests: check:scenarios demands a scenario file per spec there).
export default defineConfig({
  testDir: "./perf",
  testMatch: /\.perf\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: false,
  // One test = a cold load + N measured iterations (+ a trace) of one screen/persona; the heaviest (CEO org chart or
  // reviews at 4x CPU throttle) takes minutes. The harness sets its own per-test timeout; this is the floor.
  timeout: 30 * 60_000,
  reporter: [["list"]],
  use: {
    baseURL: PERF_BASE_URL,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "perf", use: { ...devices["Desktop Chrome"] } }],
});
