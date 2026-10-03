#!/usr/bin/env bash
# The one entry point of the performance-measurement stack (.claude/docs/performance.md).
#
#   perf/run.sh up [service...]   start the perf stack (default: everything, app image rebuilt)
#   perf/run.sh down [--wipe]     stop it; the Postgres volume survives unless --wipe
#   perf/run.sh status            containers, ports, and the dataset's row counts when reachable
#   perf/run.sh seed|snapshot|restore|pgss|k6|traces|jfr|web|report|all   — later milestone steps (stubs)
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
  sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
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

not_yet() {
  echo "perf/run.sh $1: not implemented yet (a later step of the performance plan)." >&2
  exit 2
}

case "${1:-}" in
  up) shift; cmd_up "$@" ;;
  down) shift; cmd_down "$@" ;;
  status) cmd_status ;;
  seed | snapshot | restore | pgss | k6 | traces | jfr | web | report | all) not_yet "$1" ;;
  "" | -h | --help | help) usage ;;
  *) echo "unknown subcommand: $1" >&2; usage >&2; exit 64 ;;
esac
