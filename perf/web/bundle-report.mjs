#!/usr/bin/env node
// Bundle-size report of the built SPA (.claude/docs/performance.md, "Front end"): per-chunk raw / gzip / brotli bytes over
// web/dist/assets/*.js|css, the ENTRY chunk (the module script of index.html) and the INITIAL payload (entry + the
// modulepreload/stylesheet links of index.html — what a first load must fetch before the app starts).
//
// Node stdlib only (fs + zlib + path) and deliberately outside web/ so knip/eslint never see it. A report by default; since
// v4.15.1 it is also a BUDGET GATE when given limits: the CI Web job passes --max-initial-gzip / --max-initial-files and the
// script exits 1 on overrun (the first baseline, 2026-10-04-3076bbd4, was 480,795 B gzip over 38 initial files; v4.15.1 cut it
// to ~333 kB over 8, the limits sit ~8 % above that). Deterministic for a given dist (no timestamps; gzip level 9, brotli
// quality 11), so two builds of the same sources compare exactly.
//
//   node perf/web/bundle-report.mjs [--dist web/dist] [--out bundle.json] [--quiet]
//                                   [--max-initial-gzip <bytes>] [--max-initial-files <n>]
//
// Prints a table (largest first) and, with --out, writes the JSON (the CI Web job uploads it as an artifact). A limit
// that is exceeded is printed to stderr (also with --quiet) and the exit code is 1; a malformed limit is a usage error (2).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const dist = resolve(flag('--dist') ?? join(here, '..', '..', 'web', 'dist'));
const out = flag('--out');
const quiet = args.includes('--quiet');

const limit = (name) => {
  const raw = flag(name);
  if (raw === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(raw)) {
    console.error(`bundle-report: ${name} wants a positive integer, got '${raw}'`);
    process.exit(2);
  }
  return Number(raw);
};
const maxInitialGzip = limit('--max-initial-gzip');
const maxInitialFiles = limit('--max-initial-files');

let assets;
try {
  assets = readdirSync(join(dist, 'assets')).filter((f) => /\.(js|css)$/.test(f));
} catch {
  console.error(`bundle-report: no ${join(dist, 'assets')} — run 'cd web && npm run build' first (or pass --dist)`);
  process.exit(1);
}
if (assets.length === 0) {
  console.error('bundle-report: no .js/.css chunks under dist/assets');
  process.exit(1);
}

const sizes = (buf) => ({
  raw: buf.length,
  gzip: gzipSync(buf, { level: 9 }).length,
  brotli: brotliCompressSync(buf, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length },
  }).length,
});

const chunks = assets
  .sort()
  .map((file) => ({
    file,
    kind: file.endsWith('.css') ? 'css' : 'js',
    ...sizes(readFileSync(join(dist, 'assets', file))),
  }));

// index.html decides what is "initial": the module entry script plus eager modulepreload / stylesheet links.
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const refs = (re) => [...html.matchAll(re)].map((m) => basename(m[1]));
const entryFiles = refs(/<script[^>]*type="module"[^>]*src="([^"]+)"/g);
const preloadFiles = [
  ...refs(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g),
  ...refs(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g),
];
const initialSet = new Set([...entryFiles, ...preloadFiles]);
const entry = chunks.find((c) => entryFiles.includes(c.file)) ?? null;
const initial = chunks.filter((c) => initialSet.has(c.file));

const total = (list) =>
  list.reduce((acc, c) => ({ raw: acc.raw + c.raw, gzip: acc.gzip + c.gzip, brotli: acc.brotli + c.brotli }), {
    raw: 0,
    gzip: 0,
    brotli: 0,
  });

const report = {
  schema: 1,
  entry: entry ? entry.file : null,
  initial: { files: initial.map((c) => c.file), ...total(initial) },
  totals: {
    js: { count: chunks.filter((c) => c.kind === 'js').length, ...total(chunks.filter((c) => c.kind === 'js')) },
    css: { count: chunks.filter((c) => c.kind === 'css').length, ...total(chunks.filter((c) => c.kind === 'css')) },
    all: { count: chunks.length, ...total(chunks) },
  },
  largest: chunks.slice().sort((a, b) => b.raw - a.raw)[0].file,
  chunks,
};

if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

if (!quiet) {
  const kb = (n) => `${(n / 1024).toFixed(1)}`.padStart(9);
  const rows = chunks.slice().sort((a, b) => b.raw - a.raw);
  const width = Math.max(...rows.map((c) => c.file.length), 'chunk'.length);
  console.log(`${'chunk'.padEnd(width)}  ${'raw kB'.padStart(9)} ${'gzip kB'.padStart(9)} ${'brotli kB'.padStart(9)}`);
  for (const c of rows) {
    const tag = c.file === report.entry ? '  <- entry' : initialSet.has(c.file) ? '  <- initial' : '';
    console.log(`${c.file.padEnd(width)}  ${kb(c.raw)} ${kb(c.gzip)} ${kb(c.brotli)}${tag}`);
  }
  console.log(`${'initial payload'.padEnd(width)}  ${kb(report.initial.raw)} ${kb(report.initial.gzip)} ${kb(report.initial.brotli)}`);
  console.log(`${'all chunks'.padEnd(width)}  ${kb(report.totals.all.raw)} ${kb(report.totals.all.gzip)} ${kb(report.totals.all.brotli)}`);
}

// The budget gate: every exceeded limit is named, then one non-zero exit.
const budgets = [
  ['initial gzip bytes', report.initial.gzip, maxInitialGzip],
  ['initial files', report.initial.files.length, maxInitialFiles],
].filter(([, , max]) => max !== undefined);
const over = budgets.filter(([, actual, max]) => actual > max);
if (budgets.length > 0 && !quiet) {
  for (const [what, actual, max] of budgets) console.log(`budget: ${what} ${actual} / ${max} ${actual > max ? 'OVER' : 'ok'}`);
}
if (over.length > 0) {
  for (const [what, actual, max] of over) console.error(`bundle-report: ${what} ${actual} exceeds the budget ${max}`);
  process.exit(1);
}
