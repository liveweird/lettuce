// Browser-side collection (init script + one read) and the pure analysis of what it returns. Everything the page reports
// is stamped on the page's own clock (performance.now(), origin = the navigation), so a load and the scripted interactions
// after it are sliced by [from, to) windows on one timeline.

export interface PerfStore {
  lcp: number[];
  shifts: { t: number; v: number }[];
  longtasks: { t: number; d: number }[];
  /** Event Timing entries of real interactions (interactionId > 0): the INP-style latency source. */
  events: { t: number; d: number; name: string }[];
}

export interface RawResource {
  /** pathname + query only — never the host. */
  path: string;
  api: boolean;
  start: number;
  end: number;
  transfer: number;
  decoded: number;
  serverTiming: { name: string; duration: number; description: string }[];
}

export interface PageSnapshot {
  store: PerfStore;
  resources: RawResource[];
}

/** Runs in the page before any app code (addInitScript): buffered observers + a resource-timing buffer big enough for the org chart. */
export function installObservers(): void {
  const w = window as unknown as { __perf?: PerfStore };
  if (w.__perf) return;
  const store: PerfStore = { lcp: [], shifts: [], longtasks: [], events: [] };
  w.__perf = store;
  performance.setResourceTimingBufferSize(10_000);
  const observe = (type: string, cb: (e: PerformanceEntry) => void, extra: object = {}) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(cb)).observe({
        type,
        buffered: true,
        ...extra,
      } as PerformanceObserverInit);
    } catch {
      // The entry type is unsupported in this browser: the metric stays empty.
    }
  };
  observe("largest-contentful-paint", (e) => store.lcp.push(e.startTime));
  observe("layout-shift", (e) => {
    const shift = e as unknown as { value: number; hadRecentInput: boolean };
    if (!shift.hadRecentInput) store.shifts.push({ t: e.startTime, v: shift.value });
  });
  observe("longtask", (e) => store.longtasks.push({ t: e.startTime, d: e.duration }));
  observe(
    "event",
    (e) => {
      const ev = e as unknown as { interactionId?: number };
      if ((ev.interactionId ?? 0) > 0) store.events.push({ t: e.startTime, d: e.duration, name: e.name });
    },
    { durationThreshold: 16 },
  );
}

/** Seeds the SPA's localStorage once per page (guarded by sessionStorage so later navigations of the same page keep their state). */
export function seedStorage(arg: { auth: [string, string][]; settings: Record<string, unknown> }): void {
  // The first-run onboarding tour (react-joyride) overlays the page: pretend it was seen (the e2e helpers.ts idiom).
  const orig = Storage.prototype.getItem;
  Storage.prototype.getItem = function (key: string) {
    if (typeof key === "string" && key.startsWith("lettuce.tour.seen.")) return "1";
    return orig.call(this, key);
  };
  if (sessionStorage.getItem("__perfSeeded")) return;
  for (const [k, v] of arg.auth) localStorage.setItem(k, v);
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("lettuce.viewSettings.")) localStorage.removeItem(key);
  }
  for (const [k, v] of Object.entries(arg.settings)) localStorage.setItem("lettuce.viewSettings." + k, JSON.stringify(v));
  sessionStorage.setItem("__perfSeeded", "1");
}

/** Page-side read of the store and the resource entries. */
export function readSnapshot(): PageSnapshot {
  const w = window as unknown as { __perf?: PerfStore };
  const store = w.__perf ?? { lcp: [], shifts: [], longtasks: [], events: [] };
  const resources = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).map((e) => {
    const u = new URL(e.name);
    return {
      path: u.pathname + u.search,
      api: u.pathname.startsWith("/api/"),
      start: e.startTime,
      end: e.responseEnd,
      transfer: e.transferSize,
      decoded: e.decodedBodySize,
      serverTiming: e.serverTiming.map((s) => ({ name: s.name, duration: s.duration, description: s.description })),
    };
  });
  return { store: { lcp: [...store.lcp], shifts: [...store.shifts], longtasks: [...store.longtasks], events: [...store.events] }, resources };
}

// ---------------------------------------------------------------------------------------------------------------------
// Analysis (node side, pure)
// ---------------------------------------------------------------------------------------------------------------------

export interface ApiEntry {
  p: string;
  /** start ms on the page clock, duration ms, transferred bytes */
  s: number;
  d: number;
  b: number;
  db: number | null;
  stmt: number | null;
  tx: number | null;
  app: number | null;
}

const round = (n: number, digits = 1): number => Math.round(n * 10 ** digits) / 10 ** digits;
const DB_DESC = /stmt=(\d+) tx=(\d+)/;

export function apiEntries(resources: RawResource[], from: number, to: number): ApiEntry[] {
  return resources
    .filter((r) => r.api && r.start >= from && r.start < to)
    .map((r) => {
      const db = r.serverTiming.find((s) => s.name === "db");
      const app = r.serverTiming.find((s) => s.name === "app");
      const m = db ? DB_DESC.exec(db.description) : null;
      return {
        p: r.path.length > 160 ? r.path.slice(0, 160) : r.path,
        s: round(r.start),
        d: round(r.end - r.start),
        b: r.transfer,
        db: db ? round(db.duration) : null,
        stmt: m ? Number(m[1]) : null,
        tx: m ? Number(m[2]) : null,
        app: app ? round(app.duration) : null,
      };
    })
    .sort((a, b) => a.s - b.s);
}

/** The longest chain of requests that each start after the previous one ended — the screen's request critical path (busy ms along it). */
export function criticalPathMs(entries: ApiEntry[]): number {
  const sorted = [...entries].sort((a, b) => a.s - b.s);
  const best: number[] = [];
  let max = 0;
  for (let j = 0; j < sorted.length; j += 1) {
    let before = 0;
    for (let i = 0; i < j; i += 1) {
      if (sorted[i].s + sorted[i].d <= sorted[j].s + 1) before = Math.max(before, best[i]);
    }
    best[j] = before + sorted[j].d;
    max = Math.max(max, best[j]);
  }
  return round(max);
}

export interface ApiSummary {
  count: number;
  transferBytes: number;
  /** Sum of the requests' own durations (what a serial client would wait). */
  sumMs: number;
  /** First request start -> last response end. */
  spanMs: number;
  criticalPathMs: number;
  maxMs: number;
  slowest: string | null;
  /** From Server-Timing (same-origin): summed db window, statements, transactions, app time. */
  dbMs: number;
  stmt: number;
  tx: number;
  appMs: number;
  /** Requests without a Server-Timing entry (must be 0 on the perf stack). */
  noServerTiming: number;
}

export function summarizeApi(entries: ApiEntry[]): ApiSummary {
  const sum = (f: (e: ApiEntry) => number) => entries.reduce((acc, e) => acc + f(e), 0);
  const slowest = entries.reduce<ApiEntry | null>((m, e) => (m === null || e.d > m.d ? e : m), null);
  const first = entries.length ? Math.min(...entries.map((e) => e.s)) : 0;
  const last = entries.length ? Math.max(...entries.map((e) => e.s + e.d)) : 0;
  return {
    count: entries.length,
    transferBytes: sum((e) => e.b),
    sumMs: round(sum((e) => e.d)),
    spanMs: round(last - first),
    criticalPathMs: criticalPathMs(entries),
    maxMs: slowest ? slowest.d : 0,
    slowest: slowest ? slowest.p : null,
    dbMs: round(sum((e) => e.db ?? 0)),
    stmt: sum((e) => e.stmt ?? 0),
    tx: sum((e) => e.tx ?? 0),
    appMs: round(sum((e) => e.app ?? 0)),
    noServerTiming: entries.filter((e) => e.db === null).length,
  };
}

export interface WindowMetrics {
  lcpMs: number | null;
  cls: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  /** Total blocking time: sum of max(0, duration - 50) over the window's long tasks. */
  blockingMs: number;
  longTaskMaxMs: number;
  /** INP-style: the worst Event Timing duration of an interaction in the window (8 ms granularity), null when none. */
  interactionMs: number | null;
}

export function windowMetrics(store: PerfStore, from: number, to: number): WindowMetrics {
  const inWin = <T extends { t: number }>(xs: T[]) => xs.filter((x) => x.t >= from && x.t < to);
  const tasks = inWin(store.longtasks);
  const events = inWin(store.events);
  const lcp = store.lcp.filter((t) => t >= from && t < to);
  return {
    lcpMs: lcp.length ? round(Math.max(...lcp)) : null,
    cls: round(inWin(store.shifts).reduce((acc, s) => acc + s.v, 0), 4),
    longTaskCount: tasks.length,
    longTaskTotalMs: round(tasks.reduce((acc, x) => acc + x.d, 0)),
    blockingMs: round(tasks.reduce((acc, x) => acc + Math.max(0, x.d - 50), 0)),
    longTaskMaxMs: tasks.length ? round(Math.max(...tasks.map((x) => x.d))) : 0,
    interactionMs: events.length ? Math.max(...events.map((x) => x.d)) : null,
  };
}

export interface Stat {
  median: number;
  min: number;
  max: number;
}

export function stat(values: number[]): Stat | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return { median: round(median, 3), min: s[0], max: s[s.length - 1] };
}

type Json = number | string | null | Json[] | { [key: string]: Json };

/**
 * Collapses N same-shaped iteration objects into one: every numeric leaf becomes {median, min, max}; non-numeric leaves
 * (strings, nulls) keep the LAST iteration's value; null numbers (a metric a window did not produce) are skipped.
 */
export function aggregate(iterations: Record<string, Json>[]): Record<string, Json> {
  const out: Record<string, Json> = {};
  const keys = new Set(iterations.flatMap((it) => Object.keys(it)));
  for (const key of keys) {
    const vals = iterations.map((it) => it[key]).filter((v) => v !== undefined);
    const numbers = vals.filter((v): v is number => typeof v === "number");
    if (numbers.length > 0) {
      out[key] = stat(numbers) as unknown as Json;
    } else if (vals.some((v) => typeof v === "object" && v !== null && !Array.isArray(v))) {
      out[key] = aggregate(vals.filter((v): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v)));
    } else {
      out[key] = vals[vals.length - 1] ?? null;
    }
  }
  return out;
}
