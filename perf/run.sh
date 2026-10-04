#!/usr/bin/env bash
# The one entry point of the performance-measurement stack (.claude/docs/performance.md).
#
#   perf/run.sh up [service...]   start the perf stack (default: everything, app image rebuilt)
#   perf/run.sh down [--wipe]     stop it; the Postgres volume survives unless --wipe
#   perf/run.sh status            containers, ports, and the dataset's row counts when reachable
#   perf/run.sh seed [--wipe] [--anchor D] [--seed N] [--scale X]
#                                 fresh volume -> postgres -> perfSeed -> verify.sql -> VACUUM ANALYZE -> snapshot
#   perf/run.sh snapshot          pg_dump -Fc of the seeded database into the git-ignored perf/snapshots/
#   perf/run.sh restore [file]    stop app -> recreate the database -> pg_restore -> ANALYZE -> start app
#   perf/run.sh pgss reset | dump <label> [--run ID] [--since 1h|RFC3339]
#                                 pg_stat_statements/table-stat window: reset, then dump the top statements,
#                                 per-table seq-scan deltas and auto_explain plans into perf/results/<run>/
#   perf/run.sh k6 <scenario> [--persona P] [--vus N] [--iterations N | --duration D] [--think MIN MAX]
#                             [--ramp-up D] [--run ID] [--label L] [--raw] [--no-pgss]
#                                 one k6 run (pinned image) with a pgss window around it
#   perf/run.sh report <run> [--baseline DIR] [--force]
#                                 compare perf/results/<run> with a committed baseline (scripts/perf_compare.py) -> <run>/report.md
#   perf/run.sh all [--run ID] [--skip-seed] [--only SCENARIO]
#                                 build the app image (the CURRENT checkout) -> restore (seed when no snapshot) -> run.json
#                                 (commit, image id, dataset) -> warm-up -> every scenario with a pgss window around each run
#                                 -> restore before the mixed run and after it (an EXIT trap restores if the run aborts) -> report
#   perf/run.sh baseline <run> [--name DIR]
#                                 copy the committed-size files of a run (summary/table/pgss/tables per label, no raw output,
#                                 no warm-up) into perf/baselines/<date>-<sha>/ and fail if any bearer token leaked into them
#   perf/run.sh traces <scenario> [--run ID] [--keep] [--limit N] [k6 flags]
#                                 Jaeger (profile `traces`) + the app recreated with the OTLP trace export on, one k6 iteration
#                                 (or the k6 flags you pass), then the traces exported from Jaeger's API and summarised
#                                 (<scenario>.traces.json / .traces.md in perf/results/<run>/); the app is put back afterwards
#   perf/run.sh jfr <scenario> [--c2] [--heap Nm] [--run ID] [k6 flags]
#                                 the app recreated with a JFR recording (settings=profile), the k6 scenario, a graceful stop
#                                 (the recording dumps on exit), then `jfr summary` + the ExecutionSample summary into the run dir;
#                                 --c2 turns the C2 compiler on (the shipped flags are C1-only), --heap sets -Xmx (container
#                                 limit = heap + 256m for the run); the app is put back afterwards
#   perf/run.sh web              — a later milestone step (stub)
#
# The compose PROJECT is hardcoded to `lettuce-perf`: the dev stack's containers and its
# `lettuce_postgres-data` volume are never addressed by this script. `docker compose down -v`
# is reachable ONLY through the explicit, confirmed `down --wipe`.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="lettuce-perf"
VOLUME="${PROJECT}_postgres-data"

compose() {
  docker compose -p "$PROJECT" -f "$ROOT/docker-compose.yaml" -f "$ROOT/perf/docker-compose.perf.yaml" "$@"
}

usage() {
  sed -n '2,39p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

cmd_up() {
  mkdir -p "$ROOT/perf/results/jfr" "$ROOT/perf/snapshots"
  if [ "$#" -eq 0 ]; then
    compose up --build -d
  else
    # Naming services (e.g. `up postgres` for the host-run seed generator) never builds the app image.
    compose up -d "$@"
  fi
}

cmd_down() {
  if [ "${1:-}" = "--wipe" ]; then
    echo "This DELETES the volume ${VOLUME} (the seeded dataset). The dev stack's volume is not touched."
    read -r -p "Type '${VOLUME}' to confirm: " answer
    if [ "$answer" != "$VOLUME" ]; then
      echo "Aborted — nothing was removed." >&2
      exit 1
    fi
    compose down -v
  else
    compose down
  fi
}

cmd_status() {
  compose ps
  echo
  echo "Ports: app 127.0.0.1:18080, postgres 127.0.0.1:15432 (no mail catcher, no Teams stub — see the overlay)"
  if compose exec -T postgres pg_isready -U lettuce -d lettuce >/dev/null 2>&1; then
    compose exec -T postgres psql -U lettuce -d lettuce -Atc \
      "SELECT 'users=' || (SELECT count(*) FROM users) || ' db_size=' || pg_size_pretty(pg_database_size('lettuce'))" \
      2>/dev/null || true
  fi
}

# ---------------------------------------------------------------------------------------------------------
# Step 4/5 — dataset lifecycle, pg_stat_statements windows, k6
# ---------------------------------------------------------------------------------------------------------

# The pinned k6 image (index digest, linux/amd64 + linux/arm64) — .claude/docs/container-images.md.
K6_IMAGE="grafana/k6:2.3.0@sha256:9c2dee7f8ed74d317e4027c06a10f169b625638189de8d4555d0b3486a5aeb34"
# The pinned dataset every committed baseline is measured on (override with the flags below).
DEFAULT_ANCHOR="2026-10-01"
DEFAULT_SEED="1"
DEFAULT_SCALE="1.0"
APP_URL="http://127.0.0.1:18080"

die() { echo "perf/run.sh: $*" >&2; exit 1; }

# Run ids, labels and personas become directory/file names and container env values: letters, digits, . _ - only.
safe_name() {
  case "$2" in
    "" | *[!A-Za-z0-9._-]*) die "$1 must match [A-Za-z0-9._-]+ (got '$2')" ;;
  esac
}
# --since is a relative duration (1h) or an RFC3339 time (2026-10-04T10:00:00Z).
safe_since() {
  case "$1" in
    "" | *[!A-Za-z0-9.:+-]*) die "--since must be a duration (1h) or an RFC3339 time (got '$1')" ;;
  esac
}

psql_perf() { compose exec -T postgres psql -U lettuce -d lettuce -v ON_ERROR_STOP=1 "$@"; }

wait_postgres() {
  local i
  for i in $(seq 1 60); do
    if compose exec -T postgres pg_isready -U lettuce -d postgres >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  die "postgres did not become ready"
}

# Blocks until the app answers /readyz; prints the seconds it took (the boot time against the dataset).
wait_app() {
  local start i
  start=$(date +%s)
  for i in $(seq 1 180); do
    if curl -fsS -o /dev/null "$APP_URL/readyz" 2>/dev/null; then
      echo "app ready after $(( $(date +%s) - start )) s"
      return 0
    fi
    sleep 2
  done
  die "the app did not answer /readyz within 6 minutes"
}

# The newest seed-<version>.json the generator wrote (its row counts + anchor/seed/scale), or empty.
latest_seed_json() { ls -t "$ROOT"/perf/results/seed-*.json 2>/dev/null | head -n 1 || true; }

cmd_seed() {
  local wipe=0 anchor="$DEFAULT_ANCHOR" seed="$DEFAULT_SEED" scale="$DEFAULT_SCALE"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --wipe) wipe=1 ;;
      --anchor) anchor="${2:?--anchor needs YYYY-MM-DD}"; shift ;;
      --seed) seed="${2:?--seed needs a number}"; shift ;;
      --scale) scale="${2:?--scale needs a number}"; shift ;;
      *) die "seed: unknown flag $1" ;;
    esac
    shift
  done
  if [ "$wipe" -eq 1 ]; then
    cmd_down --wipe
  fi
  cmd_up postgres
  wait_postgres
  local start
  start=$(date +%s)
  (cd "$ROOT" && ./gradlew :server:perfSeed "-Pperf.anchor=$anchor" "-Pperf.seed=$seed" "-Pperf.scale=$scale")
  echo "seed generation took $(( $(date +%s) - start )) s"
  echo "verifying the dataset (perf/pg/verify.sql)…"
  psql_perf -f - < "$ROOT/perf/pg/verify.sql"
  echo "vacuum + analyze (planner statistics + visibility map for the snapshot)…"
  psql_perf -c "VACUUM (ANALYZE)"
  cmd_snapshot
}

cmd_snapshot() {
  local meta version anchor seed scale file
  meta="$(latest_seed_json)"
  [ -n "$meta" ] || die "snapshot: no perf/results/seed-*.json — run 'perf/run.sh seed' first"
  version=$(jq -r .datasetVersion "$meta"); anchor=$(jq -r .anchor "$meta")
  seed=$(jq -r .seed "$meta"); scale=$(jq -r .scale "$meta")
  mkdir -p "$ROOT/perf/snapshots"
  file="$ROOT/perf/snapshots/lettuce-perf-v${version}-${anchor}-s${seed}-x${scale}.dump"
  # The redirect-on-host form of .claude/docs/backup-and-restore.md: the dump never lands inside the container.
  (umask 077; compose exec -T postgres pg_dump -U lettuce -d lettuce --format=custom > "$file.partial")
  mv "$file.partial" "$file"
  chmod 600 "$file"
  echo "snapshot: $file ($(du -h "$file" | cut -f1))"
}

cmd_restore() {
  local file="${1:-}"
  if [ -z "$file" ]; then
    file="$(ls -t "$ROOT"/perf/snapshots/*.dump 2>/dev/null | head -n 1 || true)"
  fi
  [ -n "$file" ] && [ -f "$file" ] || die "restore: no snapshot (perf/snapshots/*.dump) — run 'perf/run.sh seed' first"
  echo "restoring $file into the perf database (the app is stopped meanwhile)"
  local start
  start=$(date +%s)
  compose stop app >/dev/null 2>&1 || true
  cmd_up postgres
  wait_postgres
  compose exec -T postgres dropdb -U lettuce --if-exists --force lettuce
  compose exec -T postgres createdb -U lettuce lettuce
  compose exec -T postgres pg_restore -U lettuce -d lettuce --exit-on-error --no-owner < "$file"
  psql_perf -c "ANALYZE" >/dev/null
  echo "restore took $(( $(date +%s) - start )) s"
  cmd_up app
  wait_app
}

pgss_reset() {
  # pg_stat_reset() zeroes the per-table counters (seq_scan deltas); pg_stat_statements has its own reset.
  psql_perf -qAt -c "SELECT pg_stat_statements_reset(); SELECT pg_stat_reset();" >/dev/null
}

# pgss_dump <rundir> <label> <since-rfc3339>
pgss_dump() {
  local dir="$1" label="$2" since="$3"
  mkdir -p "$dir"
  # PostgreSQL's per-table counters are flushed lazily: a backend that went idle reports within ~10 s
  # (PGSTAT_IDLE_INTERVAL). pg_stat_statements lives in shared memory and needs no wait; the table
  # counters do, or the last seconds of the window (and idle pooled connections) are missing.
  sleep "${PERF_STATS_FLUSH_WAIT:-11}"
  psql_perf -f - < "$ROOT/perf/pg/pgss-dump.sql" > "$dir/$label.pgss.csv"
  psql_perf -f - < "$ROOT/perf/pg/tables-dump.sql" > "$dir/$label.tables.csv"
  compose logs --no-log-prefix --since "$since" postgres 2>/dev/null \
    | python3 "$ROOT/perf/pg/extract-auto-explain.py" > "$dir/$label.auto_explain.ndjson"
  echo "pgss: $dir/$label.{pgss.csv,tables.csv,auto_explain.ndjson}" \
    "($(($(wc -l < "$dir/$label.pgss.csv") - 1)) statements, $(wc -l < "$dir/$label.auto_explain.ndjson") plans)"
}

new_run_id() { date +%Y%m%d-%H%M%S; }

cmd_pgss() {
  local sub="${1:-}"
  shift || true
  case "$sub" in
    reset) pgss_reset; echo "pg_stat_statements and table statistics reset" ;;
    dump)
      local label="${1:?pgss dump needs a label}" run
      safe_name "label" "$label"
      shift
      run="$(new_run_id)"
      while [ "$#" -gt 0 ]; do
        case "$1" in
          --run) run="${2:?--run needs an id}"; safe_name "--run" "$run"; shift ;;
          --since) PGSS_SINCE="${2:?--since needs an RFC3339 time}"; safe_since "$PGSS_SINCE"; shift ;;
          *) die "pgss dump: unknown flag $1" ;;
        esac
        shift
      done
      # Default window start for the auto_explain log filter: the last hour.
      pgss_dump "$ROOT/perf/results/$run" "$label" "${PGSS_SINCE:-1h}"
      ;;
    *) die "usage: perf/run.sh pgss reset | dump <label> [--run ID] [--since T]" ;;
  esac
}

cmd_k6() {
  local name="${1:-}"
  [ -n "$name" ] || die "usage: perf/run.sh k6 <scenario> [flags] (scenarios: $(cd "$ROOT/perf/k6" && ls ./*.js | sed 's|./||; s|\.js$||' | tr '\n' ' '))"
  shift
  [ -f "$ROOT/perf/k6/$name.js" ] || die "k6: no scenario perf/k6/$name.js"
  local persona="" vus=1 iterations="" duration="" think_min=0 think_max=0 run label="" raw=0 pgss=1 ramp=""
  run="$(new_run_id)"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --persona) persona="${2:?--persona needs a name}"; shift ;;
      --vus) vus="${2:?--vus needs a number}"; shift ;;
      --iterations) iterations="${2:?--iterations needs a number}"; shift ;;
      --duration) duration="${2:?--duration needs e.g. 3m}"; shift ;;
      --ramp-up) ramp="${2:?--ramp-up needs e.g. 2m}"; shift ;;
      --think) think_min="${2:?--think needs MIN MAX seconds}"; think_max="${3:?--think needs MIN MAX seconds}"; shift 2 ;;
      --run) run="${2:?--run needs an id}"; shift ;;
      --label) label="${2:?--label needs a name}"; shift ;;
      --raw) raw=1 ;;
      --no-pgss) pgss=0 ;;
      *) die "k6: unknown flag $1" ;;
    esac
    shift
  done
  # reviews-team-view predates the per-screen scenarios: its default persona is the CEO's "all reports" scope; every other
  # scenario takes a persona name, or none = `mixed` (VU n takes the scenario's personas round-robin).
  if [ -z "$persona" ]; then
    if [ "$name" = "reviews-team-view" ]; then persona="ceo-all"; else persona="mixed"; fi
  fi
  safe_name "--run" "$run"; safe_name "--persona" "$persona"
  if [ -n "$label" ]; then safe_name "--label" "$label"; fi
  if [ -n "$ramp" ]; then safe_name "--ramp-up" "$ramp"; fi
  [ -n "$iterations" ] || [ -n "$duration" ] || iterations=3
  [ -n "$label" ] || label="$name.$persona.vu$vus"
  curl -fsS -o /dev/null "$APP_URL/readyz" || die "k6: the perf app does not answer on $APP_URL — 'perf/run.sh up' first"
  local dir="$ROOT/perf/results/$run"
  mkdir -p "$dir"
  local args=(run)
  if [ "$raw" -eq 1 ]; then args+=(--out "json=/out/$label.raw.json.gz"); fi
  local envs=(-e "BASE_URL=http://app:8080" -e "PERSONA=$persona" -e "VUS=$vus" -e "LABEL=$label"
              -e "THINK_MIN=$think_min" -e "THINK_MAX=$think_max")
  if [ -n "$iterations" ]; then envs+=(-e "ITERATIONS=$iterations"); else envs+=(-e "DURATION=$duration"); fi
  if [ -n "$ramp" ]; then envs+=(-e "RAMP_UP=$ramp"); fi
  if [ "$pgss" -eq 1 ]; then pgss_reset; fi
  local since
  since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local rc=0
  docker run --rm --network "${PROJECT}_default" \
    -v "$ROOT/perf/k6:/scripts:ro" -v "$dir:/out" "${envs[@]}" \
    "$K6_IMAGE" "${args[@]}" "/scripts/$name.js" || rc=$?
  if [ "$pgss" -eq 1 ]; then pgss_dump "$dir" "$label" "$since"; fi
  echo "results: $dir/$label.*"
  return "$rc"
}

# ---------------------------------------------------------------------------------------------------------
# Step 9/10 — report, the full run, committed baselines
# ---------------------------------------------------------------------------------------------------------

cmd_report() {
  local run="${1:-}"
  [ -n "$run" ] || die "usage: perf/run.sh report <run> [--baseline DIR] [--force]"
  shift
  safe_name "run" "$run"
  [ -d "$ROOT/perf/results/$run" ] || die "report: no perf/results/$run"
  python3 "$ROOT/scripts/perf_compare.py" "$ROOT/perf/results/$run" --baselines-root "$ROOT/perf/baselines" "$@"
}

# The per-persona 1-VU runs of `all`: <scenario> <personas…>. A persona that cannot reach a scenario makes k6 abort at
# init (lib/replay.js), so this table cannot silently drift from the scenarios.
PER_PERSONA_RUNS=(
  "dashboard ceo director lead ic hr admin"
  "notifications-bell ceo ic hr"
  "one-on-ones ceo director lead ic hr"
  "feedback-lists ceo lead ic hr"
  "activity-log ceo director lead ic hr"
  "days-off ceo director lead ic hr"
  "team-kpis ceo lead ic hr"
  "pulse-results ceo lead ic hr"
  "impact-log ceo lead ic hr"
  "succession ceo lead hr"
  "users-admin admin ic ceo"
)

# Globals for the EXIT trap of `all` (a trap cannot see a function's locals).
ALL_SAMPLER_PID=""
ALL_DB_DIRTY=0
all_cleanup() {
  if [ -n "$ALL_SAMPLER_PID" ]; then kill "$ALL_SAMPLER_PID" 2>/dev/null || true; ALL_SAMPLER_PID=""; fi
  if [ "$ALL_DB_DIRTY" -eq 1 ]; then
    ALL_DB_DIRTY=0
    echo "all: restoring the snapshot (the run wrote into the database)"
    cmd_restore || echo "all: RESTORE FAILED — run 'perf/run.sh restore' before the next measurement" >&2
  fi
}

cmd_all() {
  local run skip_seed=0 only=""
  FAILED_RUNS=()
  k6run() {
    echo "  k6 $*"
    cmd_k6 "$@" >/dev/null || FAILED_RUNS+=("$*")
  }
  run="$(new_run_id)"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --run) run="${2:?--run needs an id}"; safe_name "--run" "$run"; shift ;;
      --skip-seed) skip_seed=1 ;;
      --only) only="${2:?--only needs a scenario}"; safe_name "--only" "$only"; shift ;;
      *) die "all: unknown flag $1" ;;
    esac
    shift
  done
  mkdir -p "$ROOT/perf/results/$run"
  trap all_cleanup EXIT
  # The measured app is the CURRENT checkout: build the image once, here (restore only starts the already-built image).
  echo "== build the app image ($(git -C "$ROOT" rev-parse --short=8 HEAD))"
  compose build app
  if ls "$ROOT"/perf/snapshots/*.dump >/dev/null 2>&1; then
    cmd_up postgres
    wait_postgres
    cmd_restore
  elif [ "$skip_seed" -eq 0 ]; then
    cmd_seed
    cmd_restore
  else
    die "all: no snapshot and --skip-seed given"
  fi
  # run.json AFTER seed/restore: on a first run the seed (and its seed-<v>.json) only exists by now.
  local seed_json image
  seed_json="$(latest_seed_json)"
  image="$(docker inspect --format '{{.Image}}' "${PROJECT}-app" 2>/dev/null || true)"
  jq -n --arg commit "$(git -C "$ROOT" rev-parse HEAD)" --arg dirty "$(git -C "$ROOT" status --porcelain | wc -l | tr -d ' ')" \
        --arg image "$image" --slurpfile seed "${seed_json:-/dev/null}" \
     '{gitCommit: $commit, uncommittedFiles: ($dirty | tonumber), appImageId: $image} + (($seed[0] // {}) | {datasetVersion, anchor, seed, scale})' \
     > "$ROOT/perf/results/$run/run.json"
  want() { [ -z "$only" ] || [ "$only" = "$1" ]; }
  # Warm-up (JIT, caches, pools): one pass of every persona over every scenario, not recorded. Writes (mixed) excluded.
  echo "== warm-up"
  local row scenario p
  for row in "${PER_PERSONA_RUNS[@]}"; do
    scenario="${row%% *}"
    want "$scenario" || continue
    k6run "$scenario" --persona all --iterations 2 --no-pgss --run "$run" --label "warmup.$scenario" || true
  done
  if want reviews-team-view; then
    k6run reviews-team-view --persona all --iterations 3 --no-pgss --run "$run" --label "warmup.reviews-team-view" || true
  fi
  # Sign-ins write account_events; from here on the database is "dirty" until the next restore.
  ALL_DB_DIRTY=1
  echo "== 1 VU per persona (3 iterations, a pgss window each)"
  for row in "${PER_PERSONA_RUNS[@]}"; do
    scenario="${row%% *}"
    want "$scenario" || continue
    for p in ${row#* }; do
      k6run "$scenario" --persona "$p" --iterations 3 --run "$run"
    done
  done
  if want reviews-team-view; then
    for p in ceo-all ceo-direct director-all lead lead-2 hr; do
      k6run reviews-team-view --persona "$p" --iterations 3 --run "$run"
    done
  fi
  if want login; then
    k6run login --persona ic --iterations 5 --run "$run"
  fi
  echo "== 50 VUs"
  if want reviews-team-view; then
    k6run reviews-team-view --persona mixed --vus 50 --duration 3m --run "$run"
    k6run reviews-team-view --persona ceo-all --vus 50 --duration 2m --run "$run"
    k6run reviews-team-view --persona director-all --vus 50 --duration 1m --run "$run"
    k6run reviews-team-view --persona lead --vus 50 --duration 1m --run "$run"
    k6run reviews-team-view --persona hr --vus 50 --duration 1m --run "$run"
  fi
  if want login; then
    k6run login --persona mixed --vus 50 --ramp-up 30s --duration 1m --run "$run"
  fi
  if want mixed-50vu; then
    # The logins above (and every earlier run) wrote account_events/notifications: start the mixed run from the snapshot.
    ALL_DB_DIRTY=0
    cmd_restore
    ALL_DB_DIRTY=1
    local stats="$ROOT/perf/results/$run/saturation-docker-stats.txt"
    : > "$stats"
    (while true; do
       docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' lettuce-perf-app lettuce-perf-postgres >> "$stats" 2>/dev/null || true
       sleep 4
     done) &
    ALL_SAMPLER_PID=$!
    k6run mixed-50vu --persona mixed --vus 50 --ramp-up 2m --duration 5m --think 3 8 --run "$run"
    kill "$ALL_SAMPLER_PID" 2>/dev/null || true
    ALL_SAMPLER_PID=""
  fi
  # The mixed run wrote feedbacks, 1:1s and goal progress: leave the database as the snapshot has it (the EXIT trap does
  # the same if anything above aborted).
  all_cleanup
  echo "== report"
  cmd_report "$run" || true
  if [ "${#FAILED_RUNS[@]}" -gt 0 ]; then
    echo "k6 runs that failed (a threshold or a crashed scenario):"; printf '  %s\n' "${FAILED_RUNS[@]}"
  fi
  echo "run: $run (perf/results/$run)"
}

# Copies a run's small, token-free files into a new perf/baselines/<date>-<sha>/ (never overwrites a directory).
cmd_baseline() {
  local run="${1:-}" name=""
  [ -n "$run" ] || die "usage: perf/run.sh baseline <run> [--name DIR]"
  safe_name "run" "$run"
  shift
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --name) name="${2:?--name needs a directory name}"; safe_name "--name" "$name"; shift ;;
      *) die "baseline: unknown flag $1" ;;
    esac
    shift
  done
  [ -n "$name" ] || name="$(date +%Y-%m-%d)-$(git -C "$ROOT" rev-parse --short=8 HEAD)"
  local src="$ROOT/perf/results/$run" dest="$ROOT/perf/baselines/$name" f
  [ -d "$src" ] || die "baseline: no perf/results/$run"
  [ ! -e "$dest" ] || die "baseline: $dest exists — a baseline directory is never overwritten"
  mkdir -p "$dest"
  for f in "$src"/*.summary.json "$src"/*.table.md "$src"/*.pgss.csv "$src"/*.tables.csv "$src"/saturation-docker-stats.txt; do
    [ -f "$f" ] || continue
    case "$(basename "$f")" in
      warmup.*) continue ;;
      # Only the metrics the compare tool reads, and only the statistics it (and a human) uses: ~1/6 of the size.
      *.summary.json)
        jq -c '{metrics: (.metrics | with_entries(select(.key | test("^(screen_|req_wall_ms|req_stmt|req_tx|chain_|write_|http_req_failed|http_reqs|server_timing_missing|checks|iterations)")))
                | map_values({type, values: (.values | with_entries(select(.key | IN("count","avg","med","p(95)","max","rate","passes","fails"))))}))}' \
          "$f" > "$dest/$(basename "$f")" ;;
      *) cp "$f" "$dest/" ;;
    esac
  done
  if grep -rl 'eyJ' "$dest" >/dev/null 2>&1; then
    rm -rf "$dest"
    die "baseline: a JWT-shaped string (eyJ…) was found — nothing copied"
  fi
  echo "baseline: $dest ($(ls "$dest" | wc -l | tr -d ' ') files, $(du -sh "$dest" | cut -f1)) — add meta.json by hand"
}

# ---------------------------------------------------------------------------------------------------------
# M4 — traces to Jaeger, JFR CPU profiles (.claude/docs/performance.md "Traces" / "CPU profile")
# ---------------------------------------------------------------------------------------------------------

JAEGER_URL="http://127.0.0.1:16686"

# Recreates the app container from the ALREADY-BUILT image with whatever PERF_* variables the caller prefixed
# (PERF_JAVA_OPTS, PERF_APP_MEM_LIMIT, PERF_OTEL_TRACES_EXPORTER, PERF_OTEL_TRACES_SAMPLER — see the overlay), then waits for readiness.
recreate_app() {
  compose up -d --no-build --force-recreate --no-deps app >/dev/null
  wait_app
}

wait_jaeger() {
  local i
  for i in $(seq 1 60); do
    if curl -fsS -o /dev/null "$JAEGER_URL/api/v3/services" 2>/dev/null; then return 0; fi
    sleep 1
  done
  die "jaeger did not answer on $JAEGER_URL within a minute"
}

# True when the k6 flags already choose the run length (--iterations or --duration).
has_length_flag() {
  local a
  for a in "$@"; do
    case "$a" in --iterations | --duration) return 0 ;; esac
  done
  return 1
}

# Global for the EXIT trap (a trap cannot see a function's locals).
TRACES_KEEP=0
traces_cleanup() {
  trap - EXIT
  echo "traces: putting the app back (trace export off)"
  recreate_app || echo "traces: could not recreate the app — run 'perf/run.sh up'" >&2
  if [ "$TRACES_KEEP" -eq 0 ]; then compose --profile traces stop jaeger >/dev/null 2>&1 || true; fi
}

cmd_traces() {
  local name="${1:-}" run="" limit=60 maxtraces=2000 pass=()
  [ -n "$name" ] || die "usage: perf/run.sh traces <scenario> [--run ID] [--keep] [--limit N] [k6 flags]"
  shift
  [ -f "$ROOT/perf/k6/$name.js" ] || die "traces: no scenario perf/k6/$name.js"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --run) run="${2:?--run needs an id}"; shift ;;
      --keep) TRACES_KEEP=1 ;;
      --limit) limit="${2:?--limit needs a number}"; shift ;;
      *) pass+=("$1") ;;
    esac
    shift
  done
  [ -n "$run" ] || run="$(new_run_id)"
  safe_name "--run" "$run"
  case "$limit" in "" | *[!0-9]*) die "--limit must be a number" ;; esac
  local dir="$ROOT/perf/results/$run"
  mkdir -p "$dir"
  compose --profile traces up -d jaeger >/dev/null
  wait_jaeger
  trap traces_cleanup EXIT
  # The in-memory store starts empty with the container; the app is recreated so its first span is this run's.
  PERF_OTEL_TRACES_EXPORTER=otlp PERF_OTEL_TRACES_SAMPLER=always_on recreate_app
  local t_start t_end
  t_start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if has_length_flag ${pass[@]+"${pass[@]}"}; then
    cmd_k6 "$name" --run "$run" --no-pgss ${pass[@]+"${pass[@]}"}
  else
    cmd_k6 "$name" --run "$run" --no-pgss --iterations 1 ${pass[@]+"${pass[@]}"}
  fi
  # The batch span processor flushes every 5 s; let the last request's spans leave the app.
  sleep 8
  # Jaeger v2's query API is /api/v3 (OTLP JSON, one `{"result":{"resourceSpans":[…]}}` document per chunk).
  t_end="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  curl -fsS -G "$JAEGER_URL/api/v3/traces" --data-urlencode "query.service_name=lettuce" \
    --data-urlencode "query.start_time_min=$t_start" --data-urlencode "query.start_time_max=$t_end" \
    --data-urlencode "query.search_depth=$maxtraces" -o "$dir/$name.traces.json"
  python3 "$ROOT/perf/profile/trace-summary.py" "$dir/$name.traces.json" --limit "$limit" > "$dir/$name.traces.md"
  echo "traces: $dir/$name.traces.{json,md} — UI at $JAEGER_URL while Jaeger runs (--keep leaves it up)"
  head -n 3 "$dir/$name.traces.md"
}

find_jfr_tool() {
  if command -v jfr >/dev/null 2>&1; then command -v jfr; return; fi
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/jfr" ]; then echo "$JAVA_HOME/bin/jfr"; return; fi
  die "jfr: no 'jfr' tool on PATH or in \$JAVA_HOME/bin (any JDK 21+ ships it)"
}

cmd_jfr() {
  local name="${1:-}" run="" c2=0 heap="" pass=()
  [ -n "$name" ] || die "usage: perf/run.sh jfr <scenario> [--c2] [--heap Nm] [--run ID] [k6 flags]"
  shift
  [ -f "$ROOT/perf/k6/$name.js" ] || die "jfr: no scenario perf/k6/$name.js"
  local jfr_tool
  jfr_tool="$(find_jfr_tool)"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --run) run="${2:?--run needs an id}"; shift ;;
      --c2) c2=1 ;;
      --heap) heap="${2:?--heap needs e.g. 512m}"; shift ;;
      *) pass+=("$1") ;;
    esac
    shift
  done
  [ -n "$run" ] || run="$(new_run_id)"
  safe_name "--run" "$run"
  local variant="c1" opts="" mem="512m" heap_mb
  if [ "$c2" -eq 1 ]; then opts="$opts -XX:TieredStopAtLevel=4"; variant="c2"; fi
  if [ -n "$heap" ]; then
    case "$heap" in [0-9]*m) ;; *) die "--heap must look like 512m" ;; esac
    heap_mb="${heap%m}"
    case "$heap_mb" in *[!0-9]*) die "--heap must look like 512m" ;; esac
    opts="$opts -Xmx${heap}"
    mem="$((heap_mb + 256))m"
    variant="$variant-heap$heap"
  fi
  local file="$run.$name.$variant.jfr" dir="$ROOT/perf/results/$run"
  mkdir -p "$dir" "$ROOT/perf/results/jfr"
  rm -f "$ROOT/perf/results/jfr/$file"
  trap 'trap - EXIT; echo "jfr: putting the app back (shipped flags)"; recreate_app || true' EXIT
  PERF_JAVA_OPTS="-XX:StartFlightRecording=filename=/perf-out/$file,settings=profile,dumponexit=true,maxsize=256m$opts" \
    PERF_APP_MEM_LIMIT="$mem" recreate_app
  local rc=0
  cmd_k6 "$name" --run "$run" ${pass[@]+"${pass[@]}"} || rc=$?
  # A graceful stop is what makes the recording dump (dumponexit); give the dump time.
  compose stop -t 120 app >/dev/null
  [ -f "$ROOT/perf/results/jfr/$file" ] || die "jfr: no recording at perf/results/jfr/$file (did the JVM exit gracefully?)"
  mv "$ROOT/perf/results/jfr/$file" "$dir/$file"
  "$jfr_tool" summary "$dir/$file" > "$dir/$file.summary.txt"
  "$jfr_tool" print --events jdk.ExecutionSample --stack-depth 64 "$dir/$file" > "$dir/$file.samples.txt"
  "$jfr_tool" print --events jdk.GarbageCollection "$dir/$file" > "$dir/$file.gc.txt"
  python3 "$ROOT/perf/profile/jfr-summary.py" "$dir/$file.samples.txt" "$dir/$file.gc.txt" > "$dir/$file.cpu.md"
  rm -f "$dir/$file.samples.txt" "$dir/$file.gc.txt"
  echo "jfr: $dir/$file (+ .summary.txt, .cpu.md) — open the .jfr in JDK Mission Control for the flame graph"
  head -n 2 "$dir/$file.cpu.md"
  return "$rc"
}

not_yet() {
  echo "perf/run.sh $1: not implemented yet (a later step of the performance plan)." >&2
  exit 2
}

case "${1:-}" in
  up) shift; cmd_up "$@" ;;
  down) shift; cmd_down "$@" ;;
  status) cmd_status ;;
  seed) shift; cmd_seed "$@" ;;
  snapshot) cmd_snapshot ;;
  restore) shift; cmd_restore "$@" ;;
  pgss) shift; cmd_pgss "$@" ;;
  k6) shift; cmd_k6 "$@" ;;
  report) shift; cmd_report "$@" ;;
  all) shift; cmd_all "$@" ;;
  baseline) shift; cmd_baseline "$@" ;;
  traces) shift; cmd_traces "$@" ;;
  jfr) shift; cmd_jfr "$@" ;;
  web) not_yet "$1" ;;
  "" | -h | --help | help) usage ;;
  *) echo "unknown subcommand: $1" >&2; usage >&2; exit 64 ;;
esac
