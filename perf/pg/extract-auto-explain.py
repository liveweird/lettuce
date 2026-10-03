#!/usr/bin/env python3
"""Turns `docker compose logs postgres` text (stdin) into NDJSON of auto_explain plans (stdout).

auto_explain (log_format=json) logs `LOG:  duration: X ms  plan:` followed by an indented JSON document; every
log entry starts with a `%m [%p]` timestamp prefix, which is how an entry's end is found. One output line per
plan: {"durationMs": X, "plan": {...}} — the plan carries "Query Text" (a template: no bind values, see the
perf overlay's log_parameter_max_length=0), "Plan" and, with log_timing=off, row counts and buffers only.
"""
import json
import re
import sys

START = re.compile(r"LOG:\s+duration: ([0-9.]+) ms\s+plan:\s*$")
ENTRY = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}")


def flush(duration, buf, out):
    if duration is None or not buf:
        return
    try:
        out.write(json.dumps({"durationMs": float(duration), "plan": json.loads("".join(buf))}) + "\n")
    except json.JSONDecodeError:
        pass  # a truncated entry (log rotation mid-plan) — skip, never fail the dump


def main():
    duration, buf = None, []
    for line in sys.stdin:
        line = line.rstrip("\n")
        if ENTRY.match(line) or (duration is None and "LOG:" in line):
            flush(duration, buf, sys.stdout)
            duration, buf = None, []
            m = START.search(line)
            if m:
                duration = m.group(1)
        elif duration is not None:
            buf.append(line)
    flush(duration, buf, sys.stdout)


if __name__ == "__main__":
    main()
