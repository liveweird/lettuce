import csv
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import perf_compare as pc

SCRIPT = Path(__file__).with_name("perf_compare.py")


def summary(med_stmt=100, p95_wall=50.0, med_wall=40.0, failed=0.0, missing=0):
    def trend(**v):
        return {"type": "trend", "values": v}
    return {"metrics": {
        "screen_stmt{persona:a}": trend(med=med_stmt, **{"p(95)": med_stmt}),
        "screen_wall_ms{persona:a}": trend(med=med_wall, **{"p(95)": p95_wall}),
        "screen_wall_ms": trend(med=1, **{"p(95)": 1}),  # untagged aggregate: ignored
        "http_req_failed": {"type": "rate", "values": {"rate": failed}},
        "server_timing_missing": {"type": "counter", "values": {"count": missing}},
    }}


def write_csv(path, header, rows):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(rows)


PGSS = ["rank_total", "rank_calls", "queryid", "calls", "total_exec_ms", "mean_exec_ms", "max_exec_ms", "rows",
        "shared_blks_hit", "shared_blks_read", "query"]


def pgss_row(calls, total, query):
    return [1, 1, 7, calls, total, 0.1, 0.5, 1, 1, 0, query]


def make_dir(root, name, version, sm, pgss_calls=10, seq=0, label="scr.vu1", meta="meta.json"):
    d = Path(root, name)
    d.mkdir()
    (d / f"{label}.summary.json").write_text(json.dumps(sm))
    if version is not None:
        (d / meta).write_text(json.dumps({"datasetVersion": version}))
    write_csv(d / f"{label}.pgss.csv", PGSS, [pgss_row(pgss_calls, 5.0, "SELECT  1\n FROM t")])
    write_csv(d / f"{label}.tables.csv", ["relname", "seq_scan"], [["users", seq]])
    return str(d)


class MetricsTest(unittest.TestCase):
    def test_counts_are_exact_and_milliseconds_use_threshold_and_floor(self):
        rows = {r[0]: r for r in pc.compare_summaries(summary(100, 50.0), summary(101, 50.5), 10, 2)}
        self.assertEqual(rows["screen_stmt{persona:a}"][6], "CHANGED")
        self.assertEqual(rows["screen_wall_ms{persona:a}"][6], "")  # +1 %
        self.assertNotIn("screen_wall_ms", rows)
        slower = {r[0]: r for r in pc.compare_summaries(summary(), summary(p95_wall=60.0), 10, 2)}
        self.assertEqual(slower["screen_wall_ms{persona:a}"][6], "REGRESSED")
        faster = {r[0]: r for r in pc.compare_summaries(summary(), summary(p95_wall=30.0), 10, 2)}
        self.assertEqual(faster["screen_wall_ms{persona:a}"][6], "improved")
        tiny = {r[0]: r for r in pc.compare_summaries(summary(p95_wall=1.0), summary(p95_wall=1.9), 10, 2)}
        self.assertEqual(tiny["screen_wall_ms{persona:a}"][6], "")  # +90 % but under the 2 ms floor

    def test_ten_percent_boundary(self):
        # +9 % stays under the 10 % threshold, +11 % crosses it
        at = {r[0]: r for r in pc.compare_summaries(summary(p95_wall=100.0), summary(p95_wall=109.0), 10, 2)}
        over = {r[0]: r for r in pc.compare_summaries(summary(p95_wall=100.0), summary(p95_wall=111.0), 10, 2)}
        self.assertEqual(at["screen_wall_ms{persona:a}"][6], "")
        self.assertEqual(over["screen_wall_ms{persona:a}"][6], "REGRESSED")

    def test_vanished_and_new_sub_metrics_are_flagged(self):
        base, cur = summary(), summary()
        del cur["metrics"]["screen_stmt{persona:a}"]
        cur["metrics"]["screen_tx{persona:b}"] = {"type": "trend", "values": {"med": 3, "p(95)": 3}}
        rows = {r[0]: r for r in pc.compare_summaries(base, cur, 10, 2)}
        self.assertEqual(rows["screen_stmt{persona:a}"][6], "MISSING")
        self.assertEqual(rows["screen_tx{persona:b}"][6], "NEW")
        # an empty baseline (no matching run) flags nothing
        empty = pc.compare_summaries({"metrics": {}}, summary(), 10, 2)
        self.assertTrue(all(r[6] == "" for r in empty))

    def test_pgss_calls_flag_only_for_fixed_replays(self):
        base = [{"query": "SELECT 1", "calls": "10", "total_exec_ms": "5"}]
        cur = [{"query": "SELECT 1", "calls": "30", "total_exec_ms": "5"}]
        self.assertEqual(pc.compare_pgss(base, cur, 10, 10, fixed_replay=False)[0][5], "")
        self.assertEqual(pc.compare_pgss(base, cur, 10, 10, fixed_replay=True)[0][5], "CHANGED")

    def test_summary_export_flat_shape_is_read(self):
        flat = {"metrics": {"screen_stmt{persona:a}": {"med": 5, "p(95)": 5}}}
        self.assertEqual(pc.compare_summaries(flat, flat, 10, 2)[0][2], 5.0)

    def test_pgss_joins_on_normalized_text_and_flags_calls(self):
        base = [{"query": "SELECT  1\n FROM t", "calls": "10", "total_exec_ms": "5"}]
        cur = [{"query": "SELECT 1 FROM t", "calls": "30", "total_exec_ms": "9"},
               {"query": "SELECT 2", "calls": "1", "total_exec_ms": "1"}]
        rows = {r[0]: r for r in pc.compare_pgss(base, cur, 10, 10)}
        self.assertEqual(rows["SELECT 1 FROM t"][5], "CHANGED")
        self.assertEqual(rows["SELECT 2"][5], "NEW")

    def test_no_baseline_rows_flag_nothing(self):
        self.assertEqual(pc.compare_tables([], [{"relname": "a", "seq_scan": "4"}])[0][3], "")
        self.assertEqual(pc.compare_pgss([], [{"query": "SELECT 1", "calls": "3", "total_exec_ms": "1"}], 5, 10)[0][5], "")

    def test_table_seq_scan_flags(self):
        rows = pc.compare_tables([{"relname": "a", "seq_scan": "0"}], [{"relname": "a", "seq_scan": "4"}])
        self.assertEqual(rows, [("a", 0, 4, "NEW SEQ SCANS")])


class CliTest(unittest.TestCase):
    def run_cli(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, check=False)

    def test_report_flags_a_regression_and_writes_report_md(self):
        with tempfile.TemporaryDirectory() as t:
            base = make_dir(t, "base", 2, summary())
            cur = make_dir(t, "cur", 2, summary(med_stmt=130), pgss_calls=30, seq=3)
            r = self.run_cli(cur, "--baseline", base, "--fail-on-regression")
            self.assertEqual(r.returncode, 1, r.stderr)
            self.assertIn("CHANGED", r.stdout)
            self.assertIn("NEW SEQ SCANS", r.stdout)
            self.assertTrue(Path(cur, "report.md").is_file())

    def test_identical_runs_are_clean(self):
        with tempfile.TemporaryDirectory() as t:
            base = make_dir(t, "base", 2, summary())
            cur = make_dir(t, "cur", 2, summary())
            r = self.run_cli(cur, "--baseline", base, "--fail-on-regression")
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_unclean_run_is_flagged(self):
        with tempfile.TemporaryDirectory() as t:
            cur = make_dir(t, "cur", 2, summary(failed=0.5))
            empty_root = Path(t, "no-baselines")
            empty_root.mkdir()
            r = self.run_cli(cur, "--baselines-root", str(empty_root), "--fail-on-regression")
            self.assertEqual(r.returncode, 1)
            self.assertIn("RUN NOT CLEAN", r.stdout)

    def test_dataset_version_mismatch_is_refused_unless_forced(self):
        with tempfile.TemporaryDirectory() as t:
            base = make_dir(t, "base", 1, summary())
            cur = make_dir(t, "cur", 2, summary())
            self.assertEqual(self.run_cli(cur, "--baseline", base).returncode, 2)
            self.assertEqual(self.run_cli(cur, "--baseline", base, "--force").returncode, 0)

    def test_default_baseline_is_newest_with_the_same_dataset_version(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t, "baselines")
            root.mkdir()
            make_dir(root, "2026-10-04-aaa", 1, summary())
            make_dir(root, "2026-10-05-bbb", 2, summary())
            make_dir(root, "2026-10-06-ccc", 1, summary())
            self.assertTrue(pc.pick_baseline(str(root), 2).endswith("2026-10-05-bbb"))
            self.assertTrue(pc.pick_baseline(str(root), 1).endswith("2026-10-06-ccc"))
            self.assertIsNone(pc.pick_baseline(str(root), 3))

    def test_run_without_run_json_is_compared_without_refusal(self):
        with tempfile.TemporaryDirectory() as t:
            base = make_dir(t, "base", 1, summary())
            cur = make_dir(t, "cur", None, summary())  # no run.json / meta.json: version unknown
            self.assertEqual(self.run_cli(cur, "--baseline", base).returncode, 0)

    def test_run_json_carries_the_version_and_warmups_are_skipped(self):
        with tempfile.TemporaryDirectory() as t:
            base = make_dir(t, "base", 1, summary())
            cur = make_dir(t, "cur", 2, summary(), meta="run.json")
            self.assertEqual(self.run_cli(cur, "--baseline", base).returncode, 2)
            Path(cur, "warmup.scr.summary.json").write_text(json.dumps(summary(failed=0.9)))
            r = self.run_cli(cur, "--baseline", base, "--force", "--fail-on-regression")
            self.assertEqual(r.returncode, 0, r.stdout)
            self.assertNotIn("warmup.scr", r.stdout)

    def test_no_baseline_prints_current_numbers(self):
        with tempfile.TemporaryDirectory() as t:
            cur = make_dir(t, "cur", 2, summary())
            r = self.run_cli(cur, "--baselines-root", str(Path(t, "none")))
            self.assertEqual(r.returncode, 0)
            self.assertIn("no baseline", r.stdout)

    def test_missing_run_dir(self):
        self.assertEqual(self.run_cli("/nonexistent-perf-run").returncode, 2)


if __name__ == "__main__":
    unittest.main()
