#!/usr/bin/env python3
"""Summarise a Jaeger trace export (`perf/run.sh traces`) as a per-request waterfall table (stdlib only).

Input: the body of Jaeger v2's `GET /api/v3/traces` — OTLP JSON, one `{"result": {"resourceSpans": [...]}}`
document per chunk, concatenated. Output (markdown, stdout): one row per SERVER span of an /api/ request —
wall ms, number of DB spans, the sum of their durations, the part of the request NOT spent in a DB span
(serialization, decryption, chain walks, the pool acquire and its validation round trip all land here), the
slowest DB span — then a per-route aggregate. Read-only over the export; the instrumentation records
sanitised statement text only, never bind values. NOTE: SERVER spans carry the request's query string
(`url.query`) — a trace export is not for committing or for a shared store.
"""
import json
import re
import statistics
import sys
from collections import defaultdict

SERVER, CLIENT = 2, 3  # OTLP SpanKind numbers


def documents(text):
    decoder = json.JSONDecoder()
    i = 0
    while i < len(text):
        while i < len(text) and text[i].isspace():
            i += 1
        if i >= len(text):
            return
        doc, i = decoder.raw_decode(text, i)
        yield doc


def attr_value(v):
    for k in ("stringValue", "intValue", "doubleValue", "boolValue"):
        if k in v:
            return v[k]
    return None


def spans(path):
    for doc in documents(open(path, errors="replace").read()):
        for rs in doc.get("result", {}).get("resourceSpans", []):
            for ss in rs.get("scopeSpans", []):
                for sp in ss.get("spans", []):
                    sp["attrs"] = {a["key"]: attr_value(a["value"]) for a in sp.get("attributes", [])}
                    sp["start"] = int(sp["startTimeUnixNano"])
                    sp["ms"] = (int(sp["endTimeUnixNano"]) - sp["start"]) / 1e6
                    yield sp


def kind_of(sp):
    k = sp.get("kind")
    return {"SPAN_KIND_SERVER": SERVER, "SPAN_KIND_CLIENT": CLIENT}.get(k, k)


def is_db(sp):
    return kind_of(sp) == CLIENT and ("db.system.name" in sp["attrs"] or "db.system" in sp["attrs"])


def main(path, limit):
    by_trace = defaultdict(list)
    for sp in spans(path):
        by_trace[sp["traceId"]].append(sp)
    rows = []
    for trace in by_trace.values():
        servers = [s for s in trace if kind_of(s) == SERVER]
        if not servers:
            continue
        server = min(servers, key=lambda s: s["start"])
        target = str(server["attrs"].get("url.path") or server["name"])
        if not target.startswith("/api/"):
            continue
        method = server["attrs"].get("http.request.method", "?")
        db = sorted((s for s in trace if is_db(s)), key=lambda s: -s["ms"])
        db_ms = sum(s["ms"] for s in db)
        rows.append({
            # Ktor's route string carries its selectors ("/(authenticate "default")/api/...") — drop them.
            "start": server["start"], "route": f"{method} {re.sub(r'/\([^)]*\)', '', str(server['attrs'].get('http.route') or target))}",
            "wall_ms": server["ms"], "db_n": len(db), "db_ms": db_ms,
            "slow": (db[0]["name"], db[0]["ms"]) if db else ("", 0.0),
            "status": server["attrs"].get("http.response.status_code"),
        })
    rows.sort(key=lambda r: r["start"])
    print(f"## Traces: {len(rows)} /api/ requests ({len(by_trace)} traces in the export)\n")
    print("| # | request | status | wall ms | DB spans | DB ms (sum) | non-DB ms | slowest DB span |")
    print("|---|---|---:|---:|---:|---:|---:|---|")
    for i, r in enumerate(rows[:limit], 1):
        print(f"| {i} | {r['route']} | {r['status']} | {r['wall_ms']:.1f} | {r['db_n']} | {r['db_ms']:.1f} | "
              f"{r['wall_ms'] - r['db_ms']:.1f} | {r['slow'][0]} ({r['slow'][1]:.1f} ms) |")
    if len(rows) > limit:
        print(f"\n_{len(rows) - limit} more rows omitted (--limit)._")
    agg = defaultdict(list)
    for r in rows:
        agg[r["route"]].append(r)
    print("\n## Per route (median over the requests seen)\n")
    print("| route | n | wall ms | DB spans | DB ms (sum) | non-DB ms |")
    print("|---|---:|---:|---:|---:|---:|")
    for route, rs in sorted(agg.items(), key=lambda kv: -statistics.median(r["wall_ms"] for r in kv[1])):
        wall = statistics.median(r["wall_ms"] for r in rs)
        dbn = statistics.median(r["db_n"] for r in rs)
        dbms = statistics.median(r["db_ms"] for r in rs)
        print(f"| {route} | {len(rs)} | {wall:.1f} | {dbn:.0f} | {dbms:.1f} | {wall - dbms:.1f} |")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: trace-summary.py <jaeger-v3-traces.json> [--limit N]")
    lim = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 60
    main(sys.argv[1], lim)
