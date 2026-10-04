#!/usr/bin/env python3
"""Summarise the CPU samples of a JFR recording (`perf/run.sh jfr`) — stdlib only.

Input: the text of `jfr print --events jdk.ExecutionSample --stack-depth 64 <file.jfr>` and, optionally, of
`jfr print --events jdk.GarbageCollection <file.jfr>` (adds a GC section: collections and total pause per collector).
Output (markdown, stdout): the sample count, samples per thread group, the top self frames (where the CPU
actually is) and INCLUSIVE buckets — the share of samples having a frame of a family anywhere on the stack
(the questions the plan asks: AES-GCM decryption, kotlinx.serialization, bcrypt, Netty, the DB stack...).
A sample is ~10 ms of one thread on CPU under the `profile` setting; percentages are shares of samples.
"""
import re
import sys
from collections import Counter

BUCKETS = [
    ("AES-GCM (field decryption/encryption)", r"GaloisCounterMode|com\.sun\.crypto\.provider\.(AES|GHASH)|FieldCipher"),
    ("kotlinx.serialization (JSON)", r"kotlinx\.serialization"),
    ("bcrypt (sign-ins; k6 setup logs the personas in)", r"at\.favre\.lib\.crypto\.bcrypt"),
    ("Netty", r"io\.netty\."),
    ("Ktor", r"io\.ktor\."),
    ("Exposed (query building/mapping)", r"org\.jetbrains\.exposed"),
    ("r2dbc-proxy (the DB-span wrapper's statement/result proxies)", r"io\.r2dbc\.proxy"),
    ("R2DBC driver + pool (includes the proxy)", r"io\.r2dbc\."),
    ("Reactor", r"reactor\.core\."),
    ("OpenTelemetry (spans)", r"io\.opentelemetry"),
    ("compression (gzip/deflate)", r"java\.util\.zip\.|io\.ktor\.util\.cio|Compression"),
    ("Lettuce services (ch.nokillswit)", r"ch\.nokillswit\."),
    ("Kotlin coroutines machinery", r"kotlinx\.coroutines"),
]

UNIT_MS = {"ns": 1e-6, "us": 1e-3, "µs": 1e-3, "ms": 1.0, "s": 1000.0}


def samples(text):
    for m in re.finditer(r"jdk\.ExecutionSample \{(.*?)\n\}", text, re.S):
        body = m.group(1)
        thread = re.search(r'sampledThread = "([^"]*)"', body)
        stack = re.search(r"stackTrace = \[(.*?)\n\s*\]", body, re.S)
        frames = []
        if stack:
            for line in stack.group(1).splitlines():
                line = line.strip()
                if not line or line == "...":
                    continue
                frames.append(re.sub(r"\s+line:.*$", "", line))
        yield (thread.group(1) if thread else "?", frames)


def group_of(thread):
    return re.sub(r"[-#_ ]?\d+$", "", thread) or thread


def gc_section(path):
    text = open(path, errors="replace").read()
    total, count = {}, {}
    for m in re.finditer(r"jdk\.GarbageCollection \{(.*?)\n\}", text, re.S):
        body = m.group(1)
        name = re.search(r'name = "([^"]*)"', body)
        pause = re.search(r"sumOfPauses = ([\d.,]+) (ns|us|µs|ms|s)", body)
        if not name or not pause:
            continue
        ms = float(pause.group(1).replace(",", ".")) * UNIT_MS[pause.group(2)]
        total[name.group(1)] = total.get(name.group(1), 0.0) + ms
        count[name.group(1)] = count.get(name.group(1), 0) + 1
    print("\n| collector | collections | total pause ms | mean pause ms |")
    print("|---|---:|---:|---:|")
    for k in sorted(total, key=lambda k: -total[k]):
        print(f"| {k} | {count[k]} | {total[k]:.0f} | {total[k] / count[k]:.2f} |")


def main(path, gc_path=None):
    text = open(path, errors="replace").read()
    data = list(samples(text))
    n = len(data)
    print(f"## JFR execution samples: {n}\n")
    if n == 0:
        return
    threads = Counter(group_of(t) for t, _ in data)
    print("| thread group | samples | share |")
    print("|---|---:|---:|")
    for g, c in threads.most_common(10):
        print(f"| {g} | {c} | {100 * c / n:.1f}% |")
    top = Counter(f[0] for _, f in data if f)
    print("\n| top self frame | samples | share |")
    print("|---|---:|---:|")
    for fr, c in top.most_common(25):
        print(f"| `{fr}` | {c} | {100 * c / n:.1f}% |")
    print("\n| bucket | inclusive samples (any frame) | share | self samples (top frame) | share |")
    print("|---|---:|---:|---:|---:|")
    for name, rx in BUCKETS:
        pat = re.compile(rx)
        c = sum(1 for _, f in data if any(pat.search(x) for x in f))
        own = sum(1 for _, f in data if f and pat.search(f[0]))
        print(f"| {name} | {c} | {100 * c / n:.1f}% | {own} | {100 * own / n:.1f}% |")
    # Exclusive attribution: walk from the top of the stack to the first frame of a known family (JDK-internal frames
    # — String, HashMap, locks — are charged to the family that called them); the families sum to 100%.
    print("\n| nearest owner of the CPU (first known family from the top) | samples | share |")
    print("|---|---:|---:|")
    owners = Counter()
    compiled = [(name, re.compile(rx)) for name, rx in BUCKETS if not name.startswith(("R2DBC driver", "Kotlin coroutines"))]
    compiled.append(("R2DBC driver + pool (excluding the proxy)", re.compile(r"io\.r2dbc\.(postgresql|pool|spi)")))
    compiled.append(("Kotlin coroutines machinery", re.compile(r"kotlinx\.coroutines")))
    for _, f in data:
        owner = next((name for fr in f for name, pat in compiled if pat.search(fr)), "(JDK/other only)")
        owners[owner] += 1
    for name, c in owners.most_common():
        print(f"| {name} | {c} | {100 * c / n:.1f}% |")
    print("\n_Stacks are truncated at 64 frames; inclusive shares overlap (a sample can be in several buckets)._")
    if gc_path:
        gc_section(gc_path)


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        sys.exit("usage: jfr-summary.py <jfr-print-ExecutionSample.txt> [<jfr-print-GarbageCollection.txt>]")
    main(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else None)
