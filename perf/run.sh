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
#                             [--run ID] [--label L] [--raw] [--no-pgss]
#                                 one k6 run (pinned image) with a pgss window around it
#   perf/run.sh traces|jfr|web|report|all   — later milestone steps (stubs)
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
  sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
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
  local persona="ceo-all" vus=1 iterations="" duration="" think_min=0 think_max=0 run label="" raw=0 pgss=1
  run="$(new_run_id)"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --persona) persona="${2:?--persona needs a name}"; shift ;;
      --vus) vus="${2:?--vus needs a number}"; shift ;;
      --iterations) iterations="${2:?--iterations needs a number}"; shift ;;
      --duration) duration="${2:?--duration needs e.g. 3m}"; shift ;;
      --think) think_min="${2:?--think needs MIN MAX seconds}"; think_max="${3:?--think needs MIN MAX seconds}"; shift 2 ;;
      --run) run="${2:?--run needs an id}"; shift ;;
      --label) label="${2:?--label needs a name}"; shift ;;
      --raw) raw=1 ;;
      --no-pgss) pgss=0 ;;
      *) die "k6: unknown flag $1" ;;
    esac
    shift
  done
  safe_name "--run" "$run"; safe_name "--persona" "$persona"
  if [ -n "$label" ]; then safe_name "--label" "$label"; fi
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
  traces | jfr | web | report | all) not_yet "$1" ;;
  "" | -h | --help | help) usage ;;
  *) echo "unknown subcommand: $1" >&2; usage >&2; exit 64 ;;
esac
