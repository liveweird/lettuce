#!/usr/bin/env bash
set -euo pipefail

visual_dir="$(cd "$(dirname "$0")" && pwd)"
repo_dir="$(cd "$visual_dir/../.." && pwd)"
mode="${1:-compare}"
if [[ "$mode" != compare && "$mode" != capture && "$mode" != compare-candidates ]]; then
  echo 'Usage: bash e2e/visual/run-container.sh [compare|capture|compare-candidates]' >&2
  exit 2
fi
# Explicit opt-in: a separate container still competes with performance benchmarks
# for the host CPU/memory. Do not infer permission from an idle process snapshot.
if [[ "${VISUAL_QUIET_WINDOW:-}" != 1 ]]; then
  echo 'Run only after performance measurements finish; then set VISUAL_QUIET_WINDOW=1.' >&2
  exit 2
fi
pw_version="$(node -e 'const fs=require("node:fs"); const l=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(l.packages["node_modules/@playwright/test"].version)' "$repo_dir/e2e/package-lock.json")"
pinned_image="$(node -e 'const fs=require("node:fs"); const runtime=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(runtime.platform!=="linux/amd64") throw new Error("Visual baselines require linux/amd64"); process.stdout.write(runtime.image)' "$visual_dir/runtime.json")"
if [[ -n "${VISUAL_PLAYWRIGHT_IMAGE:-}" && "$VISUAL_PLAYWRIGHT_IMAGE" != "$pinned_image" ]]; then
  echo 'The requested image differs from runtime.json. Review a runtime pin change before changing the baseline environment.' >&2
  exit 2
fi
VISUAL_PLAYWRIGHT_IMAGE="$pinned_image"
image_prefix="mcr.microsoft.com/playwright:v${pw_version}-noble@sha256:"
if [[ "${VISUAL_PLAYWRIGHT_IMAGE:-}" != "$image_prefix"* ]]; then
  echo "runtime.json must pin ${image_prefix}<verified digest> to match the E2E lockfile; review the runtime upgrade before capturing new baselines." >&2
  exit 2
fi
image_digest="${VISUAL_PLAYWRIGHT_IMAGE#"$image_prefix"}"
if [[ ! "$image_digest" =~ ^[a-f0-9]{64}$ ]]; then
  echo 'The Playwright image must have a complete SHA-256 digest.' >&2
  exit 2
fi
mkdir -p "$visual_dir/snapshots" "$visual_dir/candidates" "$visual_dir/test-results" "$visual_dir/playwright-report"
docker build --platform linux/amd64 \
  --file "$visual_dir/Dockerfile" \
  --build-arg "PLAYWRIGHT_IMAGE=$VISUAL_PLAYWRIGHT_IMAGE" \
  --tag lettuce-desktop-visual:local "$repo_dir"

candidate_options=,readonly
use_candidates=0
update_mode=none
if [[ "$mode" != compare ]]; then
  use_candidates=1
fi
if [[ "$mode" == capture ]]; then
  candidate_options=
  update_mode=all
  echo 'Writing candidates/ only. Approved snapshots/ stay read-only; capture is not approval.'
fi
# No published ports, no network access to live services, and no shared dev volumes.
# Snapshot mounts are read-only during ordinary comparison, even inside the container.
docker run --rm --platform linux/amd64 --network none --ipc=private --shm-size=1g \
  --env "VISUAL_CANDIDATES=$use_candidates" \
  --mount "type=bind,src=$visual_dir/snapshots,dst=/workspace/e2e/visual/snapshots,readonly" \
  --mount "type=bind,src=$visual_dir/candidates,dst=/workspace/e2e/visual/candidates$candidate_options" \
  --mount "type=bind,src=$visual_dir/test-results,dst=/workspace/e2e/visual/test-results" \
  --mount "type=bind,src=$visual_dir/playwright-report,dst=/workspace/e2e/visual/playwright-report" \
  lettuce-desktop-visual:local --update-snapshots="$update_mode"
