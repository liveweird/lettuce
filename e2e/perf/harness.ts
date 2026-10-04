import { devices, test as base, type Browser, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPerfTargetReady, perfHost, PERF_BASE_URL } from "./env";
import {
  aggregate, apiEntries, installObservers, readSnapshot, seedStorage, summarizeApi, windowMetrics,
  type ApiEntry, type PageSnapshot,
} from "./metrics";
import { SMOKE, type PersonaKey } from "./personas";
import { mintSession, userIdOf } from "./session";

// The front-end measurement engine (.claude/docs/performance.md "Front end"). One PerfCase = one persona loading one
// route in a real Chromium against the perf stack: N measured iterations (fresh page each — empty React Query cache, shared
// context so the HTTP cache is warm after the cold first load), then an optional traced iteration, medians written to
// perf/results/<run>/web/<screen>.<label>[.cpu4x].json. Observer effects: a few PerformanceObservers and one polling loop
// (25 ms evaluate) — negligible next to the numbers measured; the Chrome trace iteration is never part of the medians.

export const test = base.extend<object, { perfTarget: void }>({
  // The fail-fast guard (no globalSetup on purpose — see env.ts): once per worker, before the first test.
  perfTarget: [
    async ({}, use) => {
      await assertPerfTargetReady();
      await use();
    },
    { scope: "worker", auto: true },
  ],
});

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "..", "..");
const RUN_DIR = process.env.PERF_RUN_DIR
  ? resolve(process.env.PERF_RUN_DIR)
  : join(REPO_ROOT, "perf", "results", `web-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const ITERATIONS = Number(process.env.PERF_ITERATIONS ?? 5);
const CPU_RATE = Number((process.env.PERF_CPU ?? "1").replace(/x$/i, ""));
const TRACE = process.env.PERF_TRACE !== "0";
// A lean Chrome trace (main-thread timeline, V8 execution, user timing, loading) — the default category set is ~20 MB for a
// one-screen load; ~70 cases per run would be gigabytes. Opens in DevTools -> Performance or ui.perfetto.dev.
const TRACE_CATEGORIES = ["-*", "devtools.timeline", "v8.execute", "blink.user_timing", "loading", "disabled-by-default-devtools.timeline"];
const QUIET_MS = 400;
const SETTLE_TIMEOUT_MS = 180_000;
// What "still loading" looks like in this SPA: Mantine's Loader (table rows, centered loaders, buttons) and Skeleton.
const LOADING_SELECTOR = ".mantine-Loader-root, .mantine-Skeleton-root";

export interface Interaction {
  name: string;
  /** Unmeasured set-up (open a panel, focus a control) that runs before the window opens. */
  prepare?: (page: Page) => Promise<void>;
  /** Performs the action; return false when it does not apply (e.g. no second page) — it is then recorded as skipped. */
  run: (page: Page) => Promise<boolean | void>;
  expectApi?: RegExp[];
  ready?: string;
}

export interface PerfCase {
  persona: PersonaKey;
  /** Names the result file: <screen>.<label>.json — unique within a screen. */
  label: string;
  /** The route of the first load; a function when it needs another persona's user id. */
  path: string | ((ids: { userIdOf: typeof userIdOf }) => Promise<string>);
  /** `lettuce.viewSettings.*` keys (without the prefix) seeded before the first load — the persona's stored view state. */
  settings?: Record<string, unknown>;
  /** Every pattern must have a finished request before the screen can count as settled. */
  expectApi: RegExp[];
  /** CSS selector that must be present (e.g. a table row) for the screen to count as settled. */
  ready?: string;
  interactions?: Interaction[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Network tracking + the settled marker
// ---------------------------------------------------------------------------------------------------------------------

class NetTracker {
  inflight = 0;
  started = 0;
  private finished: string[] = [];

  constructor(page: Page) {
    page.on("request", () => {
      this.inflight += 1;
      this.started += 1;
    });
    page.on("requestfinished", (r) => {
      this.inflight = Math.max(0, this.inflight - 1);
      this.finished.push(r.url());
    });
    page.on("requestfailed", () => {
      this.inflight = Math.max(0, this.inflight - 1);
    });
  }

  reset(): void {
    this.finished = [];
  }

  hasFinished(re: RegExp): boolean {
    return this.finished.some((u) => re.test(u));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface DomProbe {
  now: number;
  loading: boolean;
  readyPresent: boolean;
  blocker: string | null;
}

/**
 * Settled = every expected request finished, nothing in flight, no visible Loader/Skeleton and (when given) the ready
 * selector present — continuously for QUIET_MS (a new request or a reappearing loader restarts the window). Returns the
 * page-clock moment the stable stretch BEGAN, so the quiet window itself is never part of the number. Poll granularity 25 ms.
 */
async function waitSettled(
  page: Page,
  net: NetTracker,
  opts: { expectApi: RegExp[]; ready?: string },
): Promise<number> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let candidate: { at: number; started: number; wall: number } | null = null;
  let lastBlocker: string | null = "network";
  while (Date.now() < deadline) {
    const apiDone = opts.expectApi.every((re) => net.hasFinished(re));
    if (net.inflight === 0 && apiDone) {
      let probe: DomProbe | null = null;
      try {
        probe = await page.evaluate(
          ({ sel, ready }) => {
            const visible = (el: Element) => el.getClientRects().length > 0;
            const blocker = [...document.querySelectorAll(sel)].find(visible);
            return {
              now: performance.now(),
              loading: blocker !== undefined,
              readyPresent: ready ? document.querySelector(ready) !== null : true,
              blocker: blocker ? blocker.className.toString().slice(0, 80) : null,
            };
          },
          { sel: LOADING_SELECTOR, ready: opts.ready ?? null },
        );
      } catch {
        probe = null; // the execution context died mid-navigation — poll again
      }
      if (probe && !probe.loading && probe.readyPresent && net.inflight === 0) {
        if (candidate === null || candidate.started !== net.started) {
          candidate = { at: probe.now, started: net.started, wall: Date.now() };
        } else if (Date.now() - candidate.wall >= QUIET_MS) {
          return candidate.at;
        }
      } else {
        candidate = null;
        lastBlocker = probe ? (probe.loading ? `loader ${probe.blocker}` : "ready selector absent") : "navigation";
      }
    } else {
      candidate = null;
      lastBlocker = net.inflight > 0 ? `${net.inflight} request(s) in flight` : "an expected request has not finished";
    }
    await sleep(25);
  }
  throw new Error(`the screen did not settle within ${SETTLE_TIMEOUT_MS / 1000} s (blocked by: ${lastBlocker})`);
}

// ---------------------------------------------------------------------------------------------------------------------
// One iteration
// ---------------------------------------------------------------------------------------------------------------------

interface WindowResult {
  settledMs: number;
  /** Chromium's own accounting at the end of the window. */
  metrics: ReturnType<typeof windowMetrics>;
  api: ReturnType<typeof summarizeApi>;
  entries: ApiEntry[];
}

interface IterationResult {
  load: WindowResult & { staticCount: number; staticTransferBytes: number; staticDecodedBytes: number };
  interactions: Record<string, WindowResult>;
  skipped: string[];
  cdpAfterLoad: Record<string, number>;
  cdp: Record<string, number>;
}

const CDP_WANTED: Record<string, string> = {
  JSHeapUsedSize: "jsHeapUsedBytes",
  LayoutCount: "layoutCount",
  RecalcStyleCount: "recalcStyleCount",
  ScriptDuration: "scriptMs",
  TaskDuration: "taskMs",
  LayoutDuration: "layoutMs",
  RecalcStyleDuration: "recalcStyleMs",
};

async function cdpMetrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics } = (await cdp.send("Performance.getMetrics")) as { metrics: { name: string; value: number }[] };
  const out: Record<string, number> = {};
  for (const m of metrics) {
    const key = CDP_WANTED[m.name];
    if (key) out[key] = key.endsWith("Ms") ? Math.round(m.value * 1000 * 10) / 10 : m.value; // seconds -> ms
  }
  return out;
}

async function iterate(
  context: BrowserContext,
  c: PerfCase,
  path: string,
  auth: [string, string][],
): Promise<IterationResult> {
  const page = await context.newPage();
  try {
    await page.addInitScript(installObservers);
    await page.addInitScript(seedStorage, { auth, settings: c.settings ?? {} });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    if (CPU_RATE > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_RATE });
    const net = new NetTracker(page);

    await page.goto(path, { waitUntil: "commit" });
    const loadSettledAt = await waitSettled(page, net, { expectApi: c.expectApi, ready: c.ready });
    const cdpAfterLoad = await cdpMetrics(cdp);

    // Scripted interactions, one after another; each is its own window [mark, settled).
    const windows: { name: string; from: number; to: number; settledMs: number }[] = [];
    const skipped: string[] = [];
    const uses = new Map<string, number>();
    for (const step of c.interactions ?? []) {
      // A step used twice in one case (e.g. sort before and after a scope change) keeps both windows: name, name#2, …
      const n = (uses.get(step.name) ?? 0) + 1;
      uses.set(step.name, n);
      const name = n === 1 ? step.name : `${step.name}#${n}`;
      if (step.prepare) {
        await step.prepare(page);
        await sleep(150);
      }
      net.reset();
      const mark = await page.evaluate(() => performance.now());
      const ran = await step.run(page);
      if (ran === false) {
        skipped.push(name);
        continue;
      }
      const settledAt = await waitSettled(page, net, { expectApi: step.expectApi ?? [], ready: step.ready });
      // Event Timing entries are delivered after the next paint: give the observer a moment before the next window opens.
      await sleep(150);
      const end = await page.evaluate(() => performance.now());
      windows.push({ name, from: mark, to: end, settledMs: Math.round((settledAt - mark) * 10) / 10 });
    }
    const cdpFinal = await cdpMetrics(cdp);
    const snap: PageSnapshot = await page.evaluate(readSnapshot);

    const loadEnd = windows.length ? windows[0].from : Number.POSITIVE_INFINITY;
    const loadEntries = apiEntries(snap.resources, 0, loadEnd);
    const statics = snap.resources.filter((r) => !r.api && r.start < loadEnd);
    const result: IterationResult = {
      load: {
        settledMs: Math.round(loadSettledAt * 10) / 10,
        metrics: windowMetrics(snap.store, 0, loadEnd),
        api: summarizeApi(loadEntries),
        entries: loadEntries,
        staticCount: statics.length,
        staticTransferBytes: statics.reduce((acc, r) => acc + r.transfer, 0),
        staticDecodedBytes: statics.reduce((acc, r) => acc + r.decoded, 0),
      },
      interactions: {},
      skipped,
      cdpAfterLoad,
      cdp: cdpFinal,
    };
    for (const w of windows) {
      const entries = apiEntries(snap.resources, w.from, w.to);
      result.interactions[w.name] = {
        settledMs: w.settledMs,
        metrics: windowMetrics(snap.store, w.from, w.to),
        api: summarizeApi(entries),
        entries,
      };
    }
    return result;
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// One case: cold run + N measured iterations + an optional traced iteration -> one JSON
// ---------------------------------------------------------------------------------------------------------------------

type Json = number | string | null | Json[] | { [key: string]: Json };
const plain = (r: IterationResult): Record<string, Json> => {
  // The waterfall entries are kept once (last measured iteration) — they are not aggregated.
  const strip = (w: WindowResult): Record<string, Json> => {
    const { entries: _entries, ...rest } = w;
    return rest as unknown as Record<string, Json>;
  };
  const { entries: _e, ...load } = r.load;
  return {
    load: load as unknown as Record<string, Json>,
    interactions: Object.fromEntries(Object.entries(r.interactions).map(([k, v]) => [k, strip(v)])),
    cdpAfterLoad: r.cdpAfterLoad,
    cdp: r.cdp,
  };
};

async function runCase(browser: Browser, screen: string, c: PerfCase): Promise<void> {
  const session = await mintSession(c.persona);
  const path = typeof c.path === "string" ? c.path : await c.path({ userIdOf });
  const variant = CPU_RATE > 1 ? `cpu${CPU_RATE}x` : "cpu1x";
  const file = `${screen}.${c.label}${CPU_RATE > 1 ? `.${variant}` : ""}`;
  const context = await browser.newContext({ ...devices["Desktop Chrome"], baseURL: PERF_BASE_URL });
  try {
    // Iteration 0: the cold load (empty HTTP cache, JIT cold). Recorded separately, never in the medians.
    const cold = await iterate(context, c, path, session.entries);
    const measured: IterationResult[] = [];
    for (let i = 0; i < ITERATIONS; i += 1) measured.push(await iterate(context, c, path, session.entries));

    let tracePath: string | null = null;
    if (TRACE) {
      const dir = join(RUN_DIR, "web", "traces");
      mkdirSync(dir, { recursive: true });
      tracePath = join(dir, `${file}.json`);
      // Chromium tracing is browser-wide but must be started against a page: an idle anchor page, while the traced
      // iteration opens its own page beside it.
      const anchor = await context.newPage();
      try {
        await browser.startTracing(anchor, { path: tracePath, screenshots: false, categories: TRACE_CATEGORIES });
        await iterate(context, c, path, session.entries);
      } catch (error) {
        console.warn(`trace for ${file} failed: ${error instanceof Error ? error.message : String(error)}`);
        tracePath = null;
      } finally {
        await browser.stopTracing().catch(() => undefined);
        await anchor.close();
      }
    }

    const last = measured[measured.length - 1];
    const outDir = join(RUN_DIR, "web");
    mkdirSync(outDir, { recursive: true });
    const doc = {
      schema: 1,
      meta: {
        screen,
        label: c.label,
        persona: c.persona,
        variant,
        cpuThrottle: CPU_RATE,
        iterations: ITERATIONS,
        target: perfHost(),
        smoke: SMOKE,
        browser: `chromium ${browser.version()}`,
        node: process.version,
        platform: process.platform,
        startedAt: new Date().toISOString(),
        trace: tracePath ? `web/traces/${file}.json` : null,
        note: "medians over the measured iterations; the cold first load is reported separately; milliseconds on the page clock",
      },
      route: path.replace(/\?.*$/, ""),
      median: aggregate(measured.map(plain)),
      cold: plain(cold),
      skippedInteractions: last.skipped,
      // The per-request waterfall of the last measured iteration (what the Network panel would show), per window.
      waterfall: {
        load: last.load.entries,
        ...Object.fromEntries(Object.entries(last.interactions).map(([k, v]) => [k, v.entries])),
      },
      raw: measured.map((m) => ({
        loadSettledMs: m.load.settledMs,
        interactionSettledMs: Object.fromEntries(Object.entries(m.interactions).map(([k, v]) => [k, v.settledMs])),
      })),
    };
    writeFileSync(join(outDir, `${file}.json`), `${JSON.stringify(doc, null, 1)}\n`);
    const settled = doc.median.load as { settledMs?: { median: number } };
    console.log(`perf ${screen} ${c.label} ${variant}: settled median ${settled.settledMs?.median ?? "?"} ms -> web/${file}.json`);
  } finally {
    await context.close();
  }
}

/** Registers one test per case; titles are `<screen> <label>` (select with `--grep`, `perf/run.sh web <screen> --persona <label-prefix>`). */
export function definePerfScreen(screen: string, cases: PerfCase[]): void {
  test.describe(screen, () => {
    for (const c of cases) {
      test(`${screen} ${c.label}`, async ({ browser }) => {
        test.setTimeout(45 * 60_000);
        await runCase(browser, screen, c);
      });
    }
  });
}
