#!/usr/bin/env python3
"""Compare a perf run directory against a committed baseline (.claude/docs/performance.md).

    python3 scripts/perf_compare.py <run-dir> [--baseline <dir>] [--out FILE] [--threshold 10]
                                    [--floor-ms 2] [--top 10] [--force] [--fail-on-regression]

A run directory (perf/results/<run>/) and a baseline directory (perf/baselines/<date>-<sha>/) hold the same
files per k6 run, named by label: ``<label>.summary.json`` (k6 ``handleSummary`` data), ``<label>.pgss.csv``
(top statements of the window) and ``<label>.tables.csv`` (per-table access counters). The report is a
markdown document:

* k6 summaries — per sub-metric: ``p(95)`` (and the median) of the millisecond Trends, the median of the
  count Trends. Milliseconds are noisy, so they are flagged at +/- ``--threshold`` percent AND more than
  ``--floor-ms`` apart; **statement / transaction / request counts are exact** (Server-Timing and the SPA's
  own request chains), so any change at all is flagged.
* pgss — the top statements joined on their normalized query text: ``calls`` and total execution time (``calls`` are
  flagged only for ``*.vu1`` labels, a fixed replay; duration and 50-VU runs execute as many loads as the clock allows).
* a sub-metric that exists on one side only is flagged NEW / MISSING; ``warmup.*`` labels are skipped.
* tables — ``seq_scan`` per table (a new or growing sequential scan is the thing to notice).

Baselines compare only within one ``datasetVersion``: when both sides carry one (``meta.json`` /
``run.json``) and they differ, the tool refuses unless ``--force``. Standard library only.
"""
import argparse
import csv
import json
import os
import re
import sys

# Count-like Trends: exact numbers, median compared, ANY change is a regression signal.
COUNT_METRICS = ("screen_requests", "screen_stmt", "screen_tx", "req_stmt", "req_tx", "chain_requests",
                 "chain_stmt", "chain_tx")
# Millisecond Trends: p(95) compared with a relative threshold plus an absolute floor.
# (Per-request db/app milliseconds stay in the summaries; the report keeps the wall time per request.)
MS_METRICS = ("screen_wall_ms", "screen_critical_ms", "screen_seq_ms", "screen_db_ms", "req_wall_ms", "chain_wall_ms")
FLAG_DOWN = "improved"
FLAG_UP = "REGRESSED"
FLAG_COUNT = "CHANGED"
FLAG_NEW = "NEW"
FLAG_MISSING = "MISSING"
# Labels whose replay is a fixed number of iterations at ONE VU: their statement `calls` are exact. Duration / 50-VU runs execute
# as many loads as the clock allows, so their pgss `calls` are shown but never flagged.
FIXED_REPLAY_LABEL = re.compile(r"\.vu1$")
# Warm-up runs (perf/run.sh all) are not measurements.
SKIPPED_LABEL = re.compile(r"^warmup\.")


def load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def values_of(metric):
    """k6 handleSummary keeps the stats under ``values``; ``--summary-export`` flattens them."""
    if not isinstance(metric, dict):
        return {}
    inner = metric.get("values")
    return inner if isinstance(inner, dict) else metric


def stat(metrics, key, which):
    v = values_of(metrics.get(key))
    got = v.get(which)
    return float(got) if isinstance(got, (int, float)) else None


def delta_pct(base, cur):
    if base is None or cur is None:
        return None
    if base == 0:
        return 0.0 if cur == 0 else float("inf")
    return (cur - base) / abs(base) * 100.0


def fmt(v, digits=1):
    if v is None:
        return "-"
    if v == int(v) and digits <= 1:
        return str(int(v))
    return f"{v:.{digits}f}"


def fmt_pct(p):
    if p is None:
        return "-"
    if p == float("inf"):
        return "+inf"
    return f"{p:+.1f}"


def flag_ms(base, cur, threshold, floor_ms):
    pct = delta_pct(base, cur)
    if pct is None or base is None or cur is None:
        return ""
    if abs(cur - base) <= floor_ms or abs(pct) < threshold:
        return ""
    return FLAG_UP if cur > base else FLAG_DOWN


def flag_count(base, cur):
    if base is None or cur is None or base == cur:
        return ""
    return FLAG_COUNT


def metric_kind(name):
    root = name.split("{", 1)[0]
    if root in COUNT_METRICS:
        return "count"
    if root in MS_METRICS:
        return "ms"
    return None


def compare_summaries(base, cur, threshold, floor_ms):
    """Rows [(metric, kind, base_p50, cur_p50, base_p95, cur_p95, flag, delta)] for every tagged sub-metric. A sub-metric
    present on one side only is flagged NEW / MISSING (an empty baseline — no matching run — flags nothing)."""
    bm, cm = base.get("metrics", {}), cur.get("metrics", {})
    rows = []
    for name in sorted(set(bm) | set(cm)):
        kind = metric_kind(name)
        # The untagged aggregate is the same data summed over personas — only the tagged ones are compared.
        if kind is None or "{" not in name:
            continue
        one_sided = FLAG_NEW if name not in bm else FLAG_MISSING if name not in cm else ""
        if one_sided and bm and cm:
            b50, c50 = stat(bm, name, "med"), stat(cm, name, "med")
            rows.append((name, kind, b50, c50, stat(bm, name, "p(95)"), stat(cm, name, "p(95)"), one_sided, None))
            continue
        if kind == "count":
            b, c = stat(bm, name, "med"), stat(cm, name, "med")
            rows.append((name, kind, b, c, None, None, flag_count(b, c), delta_pct(b, c)))
        else:
            b50, c50 = stat(bm, name, "med"), stat(cm, name, "med")
            b95, c95 = stat(bm, name, "p(95)"), stat(cm, name, "p(95)")
            rows.append((name, kind, b50, c50, b95, c95, flag_ms(b95, c95, threshold, floor_ms), delta_pct(b95, c95)))
    return rows


def summary_failures(summary):
    """(http_req_failed rate, responses without Server-Timing) — a non-zero value invalidates the run."""
    m = summary.get("metrics", {})
    failed = values_of(m.get("http_req_failed")).get("rate")
    missing = values_of(m.get("server_timing_missing")).get("count")
    return failed, missing


def read_csv(path):
    with open(path, encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def norm_query(sql):
    return re.sub(r"\s+", " ", sql or "").strip()


def to_float(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def compare_pgss(base_rows, cur_rows, top, threshold, fixed_replay=True):
    """Top statements by total time of either side, joined on normalized text."""
    def index(rows):
        out = {}
        for r in rows:
            key = norm_query(r.get("query"))
            prev = out.get(key)
            calls = (to_float(r.get("calls")) or 0.0)
            total = (to_float(r.get("total_exec_ms")) or 0.0)
            if prev:  # the 400-char prefix can collide for two long statements: sum them
                calls += prev[0]
                total += prev[1]
            out[key] = (calls, total)
        return out

    b, c = index(base_rows), index(cur_rows)
    keys = sorted(set(b) | set(c), key=lambda k: -max(b.get(k, (0, 0))[1], c.get(k, (0, 0))[1]))[:top]
    rows = []
    for k in keys:
        bc, bt = b.get(k, (None, None))
        cc, ct = c.get(k, (None, None))
        if not base_rows:
            flag = ""  # no baseline for this label: nothing to compare with
        elif bc is None:
            flag = "NEW"
        elif cc is None:
            flag = "GONE"
        elif bc != cc and fixed_replay:
            flag = FLAG_COUNT  # calls per window are exact only for a fixed number of iterations at one VU
        else:
            flag = ""
        rows.append((k, bc, cc, bt, ct, flag))
    return rows


def compare_tables(base_rows, cur_rows):
    def seq(rows):
        return {r["relname"]: int(to_float(r.get("seq_scan")) or 0) for r in rows if r.get("relname")}

    b, c = seq(base_rows), seq(cur_rows)
    out = []
    for t in sorted(set(b) | set(c)):
        bs, cs = b.get(t, 0), c.get(t, 0)
        if bs == 0 and cs == 0:
            continue
        flag = ""
        if not base_rows:
            pass  # no baseline for this label: nothing to compare with
        elif cs > bs:
            flag = "MORE SEQ SCANS" if bs else "NEW SEQ SCANS"
        elif cs < bs:
            flag = FLAG_DOWN
        out.append((t, bs, cs, flag))
    return sorted(out, key=lambda r: -max(r[1], r[2]))


def labels_in(directory):
    names = set()
    if directory and os.path.isdir(directory):
        for f in os.listdir(directory):
            if f.endswith(".summary.json") and not SKIPPED_LABEL.match(f):
                names.add(f[: -len(".summary.json")])
    return sorted(names)


def dataset_version(directory):
    """datasetVersion from ``meta.json`` (baselines) or ``run.json`` (run directories), else None."""
    for name in ("meta.json", "run.json"):
        p = os.path.join(directory, name)
        if os.path.isfile(p):
            try:
                v = load_json(p).get("datasetVersion")
            except (ValueError, OSError):
                v = None
            if v is not None:
                return v
    return None


def pick_baseline(baselines_root, version):
    """The newest ``<date>-<sha>`` baseline directory whose meta.json carries ``version`` (or, with no version,
    the newest at all); None when there is none."""
    if not os.path.isdir(baselines_root):
        return None
    for name in sorted(os.listdir(baselines_root), reverse=True):
        d = os.path.join(baselines_root, name)
        if os.path.isfile(os.path.join(d, "meta.json")) and (version is None or dataset_version(d) == version):
            return d
    return None


def md_table(header, rows):
    out = ["| " + " | ".join(header) + " |", "|" + "|".join("---" for _ in header) + "|"]
    for r in rows:
        out.append("| " + " | ".join(str(x) for x in r) + " |")
    return out


def report(run_dir, base_dir, threshold=10.0, floor_ms=2.0, top=10):
    """Returns (markdown, regressions) — `regressions` counts flagged rows of every kind."""
    lines = [f"# Perf report — `{os.path.basename(os.path.normpath(run_dir))}`"]
    if base_dir:
        lines.append(f"baseline: `{os.path.basename(os.path.normpath(base_dir))}` (flags: ms at +/-{threshold:g} % and "
                     f"more than {floor_ms:g} ms apart; counts: any change; statement calls: any change in .vu1 runs; NEW/MISSING sub-metrics)")
    else:
        lines.append("no baseline — current numbers only")
    regressions = 0
    cur_labels, base_labels = labels_in(run_dir), labels_in(base_dir)
    for label in cur_labels:
        lines += ["", f"## {label}"]
        cur = load_json(os.path.join(run_dir, f"{label}.summary.json"))
        failed, missing = summary_failures(cur)
        if failed or missing:
            lines.append(f"**RUN NOT CLEAN**: failed-request rate {failed}, responses without Server-Timing {missing}")
            regressions += 1
        has_base = label in base_labels
        base = load_json(os.path.join(base_dir, f"{label}.summary.json")) if has_base else {"metrics": {}}
        if base_dir and not has_base:
            lines.append("_no matching baseline run for this label_")
        rows = compare_summaries(base, cur, threshold, floor_ms)
        body = []
        for name, kind, b50, c50, b95, c95, flag, pct in rows:
            if kind == "count":
                body.append((name, "median", fmt(b50), fmt(c50), fmt_pct(pct), flag))
            else:
                body.append((name, "p95 (med)", f"{fmt(b95)} ({fmt(b50)})", f"{fmt(c95)} ({fmt(c50)})", fmt_pct(pct), flag))
            if flag in (FLAG_UP, FLAG_COUNT, FLAG_MISSING, FLAG_NEW):
                regressions += 1
        lines += md_table(["metric", "stat", "baseline", "current", "Δ %", "flag"], body)
        lines += _csv_sections(run_dir, base_dir if has_base else None, label, top, threshold)
    only_base = [x for x in base_labels if x not in cur_labels]
    if only_base:
        lines += ["", "Baseline runs with no counterpart in this run: " + ", ".join(f"`{x}`" for x in only_base)]
    return "\n".join(lines) + "\n", regressions


def _csv_sections(run_dir, base_dir, label, top, threshold):
    lines = []
    cur_pgss = os.path.join(run_dir, f"{label}.pgss.csv")
    base_pgss = os.path.join(base_dir, f"{label}.pgss.csv") if base_dir else None
    if os.path.isfile(cur_pgss):
        base_rows = read_csv(base_pgss) if base_pgss and os.path.isfile(base_pgss) else []
        rows = compare_pgss(base_rows, read_csv(cur_pgss), top, threshold, bool(FIXED_REPLAY_LABEL.search(label)))
        body = []
        for k, bc, cc, bt, ct, flag in rows:
            body.append((f"`{k[:90]}`", fmt(bc), fmt(cc), fmt_pct(delta_pct(bc, cc)), fmt(bt), fmt(ct), flag))
        lines += ["", f"**Top {top} statements** (calls and total ms in the window):"]
        lines += md_table(["statement", "calls base", "calls cur", "Δ %", "total ms base", "total ms cur", "flag"], body)
    cur_tab = os.path.join(run_dir, f"{label}.tables.csv")
    base_tab = os.path.join(base_dir, f"{label}.tables.csv") if base_dir else None
    if os.path.isfile(cur_tab):
        base_rows = read_csv(base_tab) if base_tab and os.path.isfile(base_tab) else []
        rows = compare_tables(base_rows, read_csv(cur_tab))
        if rows:
            lines += ["", "**Sequential scans per table:**"]
            lines += md_table(["table", "seq_scan base", "seq_scan cur", "flag"], rows)
    return lines


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("run_dir")
    ap.add_argument("--baseline", help="baseline directory (default: the newest perf/baselines/* with the same datasetVersion)")
    ap.add_argument("--baselines-root", default=None, help="where the default baseline is looked up")
    ap.add_argument("--out", help="write the markdown here as well (default <run-dir>/report.md)")
    ap.add_argument("--threshold", type=float, default=10.0, help="percent for millisecond flags (default 10)")
    ap.add_argument("--floor-ms", type=float, default=2.0, help="ignore millisecond changes below this (default 2)")
    ap.add_argument("--top", type=int, default=10, help="statements listed per run (default 10)")
    ap.add_argument("--force", action="store_true", help="compare across datasetVersions anyway")
    ap.add_argument("--fail-on-regression", action="store_true", help="exit 1 when any row is flagged")
    args = ap.parse_args(argv)

    if not os.path.isdir(args.run_dir):
        print(f"perf_compare: no such run directory: {args.run_dir}", file=sys.stderr)
        return 2
    root = args.baselines_root or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "perf", "baselines")
    run_version = dataset_version(args.run_dir)
    base_dir = args.baseline or pick_baseline(root, run_version)
    if base_dir and not os.path.isdir(base_dir):
        print(f"perf_compare: no such baseline directory: {base_dir}", file=sys.stderr)
        return 2
    if base_dir:
        base_version = dataset_version(base_dir)
        if run_version is not None and base_version is not None and run_version != base_version and not args.force:
            print(f"perf_compare: dataset version mismatch (run {run_version}, baseline {base_version}) — "
                  "baselines compare only within one datasetVersion (--force to override)", file=sys.stderr)
            return 2
    text, regressions = report(args.run_dir, base_dir, args.threshold, args.floor_ms, args.top)
    out = args.out or os.path.join(args.run_dir, "report.md")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(text)
    sys.stdout.write(text)
    print(f"\nperf_compare: {regressions} flagged row(s); wrote {out}", file=sys.stderr)
    return 1 if (args.fail_on_regression and regressions) else 0


if __name__ == "__main__":
    sys.exit(main())
