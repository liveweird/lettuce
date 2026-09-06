#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/lettuce-build-context.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

mkdir -p "$fixture/source/.git/refs/heads/build" \
    "$fixture/source/core/build" "$fixture/source/server/build" \
    "$fixture/source/web/node_modules" "$fixture/source/web/dist" \
    "$fixture/source/.gradle"
cp "$repo_root/.dockerignore" "$fixture/source/.dockerignore"
printf 'synthetic-ref\n' > "$fixture/source/.git/refs/heads/build/probe"
for excluded in core/build server/build web/node_modules web/dist .gradle; do
    printf 'excluded\n' > "$fixture/source/$excluded/probe"
done
# The built-in frontend and scratch stage need no registry pulls or application build.
printf 'FROM scratch\nCOPY . /context\n' > "$fixture/source/Dockerfile"
if ! docker build --progress=plain --output "type=local,dest=$fixture/result" \
    "$fixture/source" > "$fixture/build.log" 2>&1; then
    cat "$fixture/build.log" >&2
    exit 1
fi

test -f "$fixture/result/context/.git/refs/heads/build/probe"
for excluded in core/build server/build web/node_modules web/dist .gradle; do
    if test -e "$fixture/result/context/$excluded"; then
        printf 'Build context unexpectedly contains %s\n' "$excluded" >&2
        exit 1
    fi
done
printf 'PASS: Git build/* refs are included; generated output and dependency caches are excluded.\n'
