# Backup and restore

This runbook covers a logical PostgreSQL recovery of lettuce. It is a recovery procedure, not a
claim that the deployment has production disaster recovery. The database archive contains
application ciphertext for encrypted fields, but it still contains sensitive plaintext metadata,
identity data, password hashes, integration-key hashes, and other business data. Treat every dump
as confidential.

## Recovery set

Keep these parts together as one dated recovery set, while storing each according to its own
access policy:

- A custom-format `pg_dump` of the lettuce database, created with `--create`.
- A separate `pg_dumpall --globals-only` file. It carries cluster roles, role memberships,
  tablespaces, and role password hashes that `pg_dump` does not include.
- The separately escrowed database/runtime configuration: database endpoints and role names,
  PostgreSQL major and exact image/package version, required extensions, database/role settings,
  `postgresql.conf` overrides, `pg_hba.conf` or managed-service equivalents, and infrastructure
  settings. A globals dump does not capture the whole PostgreSQL instance configuration.
- The exact lettuce application image ID/digest. Application readiness verification must use the
  same application artifact as the source deployment; a mutable image tag is insufficient.
- The current `DATA_ENCRYPTION_KEY` and, during a rotation, `DATA_ENCRYPTION_KEY_PREVIOUS`.
  Escrow these outside the database backup and under a separate access policy. Never put either
  key in the dump, its manifest, command output, logs, or tickets. Losing every key that can decrypt
  a stored envelope makes the affected business content unrecoverable.

Use encrypted storage and transport, restrict temporary directories to mode `0700` and files to
`0600`, record checksums without printing dump contents, and remove plaintext temporary files as
soon as verification finishes. Define retention, immutable/off-host copies, access logging,
rotation, and deletion in the deployment's backup policy; this repository does not provide them.

## Backup

Run `pg_dump`, `pg_dumpall`, `pg_restore`, and `psql` from the same PostgreSQL major as the source.
Also require either GNU `sha256sum` or `shasum` for the protected manifest checksums. The bounded
local Compose workflow below additionally uses Docker, `jq`, `openssl`, Perl, and Python 3 (standard
library only) for the committed definition comparator. Resolve the source database and role from
the deployment's secret/config provider without echoing them. The source access used by this
procedure is read-only: do not create test rows, change roles, or run migrations on it.

```bash
set -Eeuo pipefail
umask 077
: "${TMPDIR:=/tmp}"
BACKUP_DIR=$(mktemp -d "${TMPDIR%/}/lettuce-restore.XXXXXX")
test -n "$BACKUP_DIR" && test -d "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Host-client form: set PGHOST/PGUSER/PGDATABASE and credentials securely first.
pg_dumpall --globals-only > "$BACKUP_DIR/globals.sql"
pg_dump --format=custom --create --clean --if-exists > "$BACKUP_DIR/database.dump"
chmod 600 "$BACKUP_DIR/globals.sql" "$BACKUP_DIR/database.dump"

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$BACKUP_DIR/globals.sql" "$BACKUP_DIR/database.dump"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$BACKUP_DIR/globals.sql" "$BACKUP_DIR/database.dump"
else
  echo "A SHA-256 tool is required" >&2
  exit 1
fi
```

When the PostgreSQL clients run inside a container but the protected backup directory is on the
host, redirect on the host:

```bash
set -Eeuo pipefail
: "${SOURCE_DB_CONTAINER:?set the inspected source database container name}"

docker exec "$SOURCE_DB_CONTAINER" sh -ceu \
  'exec pg_dumpall -U "$POSTGRES_USER" --globals-only' \
  > "$BACKUP_DIR/globals.sql"
docker exec "$SOURCE_DB_CONTAINER" sh -ceu \
  'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --create --clean --if-exists' \
  > "$BACKUP_DIR/database.dump"
chmod 600 "$BACKUP_DIR/globals.sql" "$BACKUP_DIR/database.dump"
```

The redirections above are evaluated by the host shell. Do not pass a host-only path to a client
inside the container, and do not leave the only backup in a disposable container filesystem.

Record the PostgreSQL server major, exact image ID/package version, dump-tool version, archive
checksums, creation time, source deployment identifier, database name, and exact lettuce
application image ID/digest in a protected manifest. Do not record credentials or encryption keys
there. `pg_restore --list database.dump` must succeed before accepting the archive.

## Restore into an isolated target

Use a fresh target, a fresh volume, and the same PostgreSQL major. Never attach the source volume.
For the official PostgreSQL 18+ container image, mount the volume at `/var/lib/postgresql`, not the
old `/var/lib/postgresql/data` target; the image deliberately refuses the old layout. Confirm the
target has no published host ports. For a rehearsal, attach it only to a newly created Docker
`--internal` network.

Create a temporary bootstrap superuser with a generated password held only in memory. Restore
globals first, then restore the database with the explicit `--create` option:

```bash
set -Eeuo pipefail
: "${RESTORE_PGHOST:?set the isolated restore host}"
: "${RESTORE_PGPORT:?set the isolated restore port}"

psql --host "$RESTORE_PGHOST" --port "$RESTORE_PGPORT" \
  --set ON_ERROR_STOP=1 --username restore_bootstrap \
  --dbname restore_control < "$BACKUP_DIR/globals.sql"

pg_restore --host "$RESTORE_PGHOST" --port "$RESTORE_PGPORT" \
  --exit-on-error --create --username restore_bootstrap \
  --dbname restore_control < "$BACKUP_DIR/database.dump"
```

`RESTORE_PGHOST` and `RESTORE_PGPORT` must identify the isolated target explicitly; never inherit
the source `PGHOST`/`PGPORT` from the backup step. The concrete Docker recipe below instead runs
clients inside the named restore container and therefore does not use host connection variables.

`--create` is required even though the archive was produced with `pg_dump --create`. Without the
restore flag, `pg_restore` places the archived objects in the control database instead of creating
and selecting the source-named database.

### Concrete local Compose target

The following commands are the reviewed local shape for this repository. Run them in one Bash
session after creating `BACKUP_DIR` with the backup commands above. They deliberately create a
fresh volume and internal network and publish no ports. They do not apply to managed PostgreSQL or
production orchestration.

```bash
set -Eeuo pipefail
umask 077
: "${BACKUP_DIR:?set the protected host backup directory}"
test -d "$BACKUP_DIR"
SOURCE_PG=lettuce-postgres
SOURCE_APP=lettuce-app
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RESTORE_PG="lettuce-restore-${RUN_ID}-postgres"
RESTORE_APP="lettuce-restore-${RUN_ID}-app"
RESTORE_NETWORK="lettuce-restore-${RUN_ID}-net"
RESTORE_VOLUME="lettuce-restore-${RUN_ID}-vol"

cleanup_restore_rehearsal() (
  set +e
  docker rm -f "$RESTORE_APP" >/dev/null 2>&1
  docker rm -f "$RESTORE_PG" >/dev/null 2>&1
  docker volume rm "$RESTORE_VOLUME" >/dev/null 2>&1
  docker network rm "$RESTORE_NETWORK" >/dev/null 2>&1
  rm -f "$BACKUP_DIR/restore-postgres.env" "$BACKUP_DIR/restore-app.env"
)
trap cleanup_restore_rehearsal EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Inspect labels and state only. Do not print container environment values.
docker inspect "$SOURCE_PG" "$SOURCE_APP" --format \
  '{{.Name}} project={{index .Config.Labels "com.docker.compose.project"}} service={{index .Config.Labels "com.docker.compose.service"}} state={{.State.Status}} image={{.Image}}'
PG_IMAGE_ID=$(docker inspect "$SOURCE_PG" --format '{{.Image}}')
APP_IMAGE_ID=$(docker inspect "$SOURCE_APP" --format '{{.Image}}')
SOURCE_DB=$(docker exec "$SOURCE_PG" sh -ceu 'printf %s "$POSTGRES_DB"')
SOURCE_DEVELOPMENT=$(docker inspect "$SOURCE_APP" | jq -r \
  '[.[0].Config.Env[] | select(startswith("KTOR_DEVELOPMENT=")) | split("=")[1]] | last // ""')
test "$SOURCE_DEVELOPMENT" = true

printf 'POSTGRES_USER=restore_bootstrap\nPOSTGRES_PASSWORD=%s\nPOSTGRES_DB=restore_control\n' \
  "$(openssl rand -hex 24)" > "$BACKUP_DIR/restore-postgres.env"
chmod 600 "$BACKUP_DIR/restore-postgres.env"

docker network create --internal "$RESTORE_NETWORK" >/dev/null
docker volume create "$RESTORE_VOLUME" >/dev/null
docker run -d --name "$RESTORE_PG" --network "$RESTORE_NETWORK" \
  --network-alias restored-postgres \
  --mount "source=$RESTORE_VOLUME,target=/var/lib/postgresql" \
  --env-file "$BACKUP_DIR/restore-postgres.env" "$PG_IMAGE_ID" >/dev/null
test -z "$(docker port "$RESTORE_PG")"
test "$(docker network inspect "$RESTORE_NETWORK" --format '{{.Internal}}')" = true

ready=false
for _ in $(seq 1 60); do
  if docker exec "$RESTORE_PG" \
    pg_isready -U restore_bootstrap -d restore_control >/dev/null 2>&1; then
    ready=true
    break
  fi
  test "$(docker inspect "$RESTORE_PG" --format '{{.State.Running}}')" = true
  sleep 1
done
test "$ready" = true

docker exec -i "$RESTORE_PG" psql --set ON_ERROR_STOP=1 \
  -U restore_bootstrap -d restore_control < "$BACKUP_DIR/globals.sql"
docker exec -i "$RESTORE_PG" pg_restore --exit-on-error --create \
  -U restore_bootstrap -d restore_control < "$BACKUP_DIR/database.dump"
docker exec "$RESTORE_PG" psql -U restore_bootstrap -d "$SOURCE_DB" \
  -AtX -c 'SELECT 1' >/dev/null
```

Keep this shell open and run every database verification below before starting the application.
The `trap` removes only the exact resources named by this session. Explicitly run
`cleanup_restore_rehearsal` when verification finishes, then clear the trap with
`trap - EXIT INT TERM`; the cleanup operations are intentionally idempotent.

Restore into a PostgreSQL server that is not reachable by users or the source application. Do not
start lettuce against it until the database-only comparisons below finish: application startup can
run the encrypted-field legacy/rotation backfill and therefore change ciphertext in the restored
copy.

## Database verification

Fail the recovery if any archive/SQL command exits nonzero. Verify at least:

1. `pg_restore --list` accepts the archive, globals restore succeeds, and database restore succeeds
   with `--exit-on-error --create`.
2. All `flyway_schema_history` rows match by installed rank, version, description, type, script,
   checksum, and success flag. Confirm the latest successful migration is the expected release.
3. Every non-system sequence matches by schema/name, type, start/min/max, increment, cycle, cache,
   and `last_value`.
4. Roles match by name, login/superuser/inherit/create-role/create-database/replication attributes,
   connection limit, validity, memberships, settings, and password hash. Compare database owner,
   encoding, locale provider/collation/ctype, connection limit, and `pg_db_role_setting`. Exclude
   only the named disposable bootstrap role from a rehearsal comparison.
5. Schema inventories and logical properties match: relation name/kind/persistence/owner; columns
   by name/type/nullability/default/length/precision/identity/generated expression; constraints by
   name/type/logical column names/reference/actions/validation/deferral flags; indexes by name,
   logical key column names and uniqueness/primary/exclusion/validity flags; plus extensions,
   triggers, functions, and comments. Separately compare every CHECK definition from
   `pg_get_constraintdef` and every index definition from `pg_get_indexdef`, including expression
   indexes and partial predicates; do not infer their equality from keys and flags.
6. All table content matches a deterministic rendering of the captured archive and a fresh dump
   of the restored database. One reviewed method is to render both custom archives with
   `pg_restore --data-only`, remove only PostgreSQL's randomized `\restrict`/`\unrestrict` guard
   lines, sort rows within each `COPY ... FROM stdin` block, and byte-compare the results. Keep the
   `COPY` headers and every other SQL statement, including every `setval`, in the comparison.

Do not require raw schema-only dump text to be byte-identical after a round trip. PostgreSQL can
compact physical attribute numbers left by historical dropped columns, reorder independent DDL,
change transient `pg_index.indcheckxmin`, and deparse equivalent CHECK/index expressions
differently. The checks above compare logical column names and stable catalog properties instead.
The original archive's schema DDL must still be applied with `pg_restore --exit-on-error`; do not
drop schema categories or ignore arbitrary diff lines to make a comparison pass.

For the local Compose variables above, extract the definition sets into protected files without
including table data, role hashes, or column defaults:

```bash
CHECK_QUERY="SELECT n.nspname,c.relname,con.conname,pg_get_constraintdef(con.oid,true) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND con.contype='c' ORDER BY 1,2,3"
INDEX_QUERY="SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog','information_schema','pg_toast') ORDER BY 1,2,3"

for KIND in checks indexes; do
  if [ "$KIND" = checks ]; then QUERY=$CHECK_QUERY; else QUERY=$INDEX_QUERY; fi
  docker exec "$SOURCE_PG" sh -ceu \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -AtX -F "|" -c "$1"' \
    sh "$QUERY" > "$BACKUP_DIR/source-$KIND.txt"
  docker exec "$RESTORE_PG" psql -U restore_bootstrap -d "$SOURCE_DB" \
    -AtX -F '|' -c "$QUERY" > "$BACKUP_DIR/restored-$KIND.txt"
  chmod 600 "$BACKUP_DIR/source-$KIND.txt" "$BACKUP_DIR/restored-$KIND.txt"
done

python3 scripts/compare_postgres_definitions.py checks \
  "$BACKUP_DIR/source-checks.txt" "$BACKUP_DIR/restored-checks.txt"
python3 scripts/compare_postgres_definitions.py indexes \
  "$BACKUP_DIR/source-indexes.txt" "$BACKUP_DIR/restored-indexes.txt"
```

Byte comparison can require one deliberately narrow normalization because PostgreSQL can reparse an
array of enum-like string literals into an equivalent cast spelling. The reviewed normalizer accepts
only uppercase/underscore string literals cast to unbounded `character varying`, and rewrites only
these four ways of producing a `text[]` to `ARRAY['X'::text, ...]`:

- `ARRAY['X'::character varying, ...]::text[]`
- `(ARRAY['X'::character varying, ...])::text[]`
- `ARRAY['X'::character varying::text, ...]`
- `ARRAY[('X'::character varying)::text, ...]`

The committed
[`scripts/compare_postgres_definitions.py`](../../scripts/compare_postgres_definitions.py) requires
exactly four pipe-separated fields per row: `schema|table|object|definition`. It rejects empty or
duplicate object identities, maps rows by the first three identity fields instead of relying on
input order, and applies normalization only to the complete fourth-field definition. It rejects
changed object sets or any definition difference remaining after normalization. Unsupported
literals, bounded-varchar casts, and other cast forms remain unchanged, so identical unsupported
forms still match while differing ones fail. This keeps literals, operators, column casts, index
keys, and partial predicates in the equality check. Trigger definitions and function bodies require
direct byte equality from
`pg_get_triggerdef(..., true)` and `pg_get_functiondef(...)`; do not normalize them.

## Encryption and application readiness

After database comparisons, boot the exact lettuce application image against only the restored
database. Put it on the isolated network with no host ports. Match the source development/
production mode, because changing mode can trigger seed-account behavior. Use a fresh rehearsal
`JWT_SECRET`; do not copy the source signing key or `ADMIN_INITIAL_PASSWORD`. Set
`MAIL_TRANSPORT=disabled`, disable the integration API, disable telemetry export, and disable any
deployment-specific schedulers or outbound side effects before starting.

Supply the escrowed current and fallback data-encryption keys through protected in-memory or mode
`0600` secret material without printing them. When a fallback key is configured, startup runs the
rotation backfill and re-encrypts every encrypted-at-rest service under the current key. A completed
bootstrap followed by a successful `/readyz` response therefore verifies that restored envelopes
can be decrypted with the supplied current/fallback set. This mutates ciphertext in the disposable
database, which is why content and sequence comparisons happen first.

That readiness inference is conditional on a fallback key being configured and encrypted envelopes
actually existing. Without a fallback key, bootstrap skips already enveloped ciphertext, so
`/readyz` alone does not prove decryption. In that case, exercise a sanitized decrypting read for
every encrypted-at-rest service or run a dedicated verifier that decrypts every encrypted column
without returning plaintext. In either case, first record a nonzero aggregate envelope count with
read-only queries; report only the count.

For the local Compose rehearsal above, build the protected application environment without copying
the source JWT or initial-admin password, then start and probe the clone:

```bash
docker inspect "$SOURCE_APP" | jq -r \
  '.[0].Config.Env[] | select(startswith("DATA_ENCRYPTION_KEY=") or
    startswith("DATA_ENCRYPTION_KEY_PREVIOUS=") or
    startswith("POSTGRES_USER=") or startswith("POSTGRES_PASSWORD="))' \
  > "$BACKUP_DIR/restore-app.env"
printf '%s\n' \
  "JWT_SECRET=$(openssl rand -hex 32)" \
  "POSTGRES_JDBC_URL=jdbc:postgresql://restored-postgres:5432/$SOURCE_DB" \
  "POSTGRES_R2DBC_URL=r2dbc:postgresql://restored-postgres:5432/$SOURCE_DB" \
  'KTOR_DEVELOPMENT=true' 'MAIL_TRANSPORT=disabled' \
  'INTEGRATION_ENABLED=false' 'OTEL_SDK_DISABLED=true' \
  >> "$BACKUP_DIR/restore-app.env"
chmod 600 "$BACKUP_DIR/restore-app.env"

docker run -d --name "$RESTORE_APP" --network "$RESTORE_NETWORK" \
  --network-alias restored-app --env-file "$BACKUP_DIR/restore-app.env" \
  "$APP_IMAGE_ID" >/dev/null
test -z "$(docker port "$RESTORE_APP")"

app_ready=false
for _ in $(seq 1 90); do
  if docker exec "$RESTORE_PG" sh -ceu \
    'wget -qO- http://restored-app:8080/readyz >/dev/null'; then
    app_ready=true
    break
  fi
  test "$(docker inspect "$RESTORE_APP" --format '{{.State.Running}}')" = true
  sleep 1
done
test "$app_ready" = true
```

This exact local stack uses development mode. If the inspected source is not this repository's
development Compose stack, stop instead of copying this setting into another environment.

Application readiness does not prove user journeys, authorization, outbound email, integrations,
or performance. Add deployment-specific smoke tests only when they can run without external side
effects or source credentials.

## Cleanup

Remove the isolated application container, PostgreSQL container, fresh volume, internal network,
environment file, dumps, logical renderings, diffs, and checksums recorded as owned by the
rehearsal. Resolve and validate every exact disposable name/path before removal; never use a broad
glob or a source Compose project/volume. Confirm each recorded owned resource and temp path is gone,
without removing or making assertions about similarly named resources that predated the rehearsal.
Confirm the source application and database are still running and healthy.

## Rehearsal record: 2026-09-06

A development Compose rehearsal used the running `lettuce-app` and healthy `lettuce-postgres`
services whose Compose labels pointed to this checkout's base and override files. Source database
access consisted only of `pg_dump`, `pg_dumpall`, and read queries.

The 760,155-byte custom archive and 669-byte globals file restored into a fresh internal-only
PostgreSQL 18 container using the exact source image ID and a new volume. The restored database
matched all deterministically normalized table data, all 75 Flyway history rows through V75, all
35 sequence states, 17 role records (excluding only the disposable bootstrap role), database
owner/locale/runtime settings, and the logical schema categories listed above. An isolated exact
application-image clone used a fresh JWT secret, disabled mail/integration/telemetry, no host ports,
and the source current/fallback encryption-key set from protected memory; startup encryption
bootstrap completed and `/readyz` succeeded. The source services remained running.

A focused schema-only source-to-fresh-target check then compared all 21 CHECK definitions and all
126 index definitions. The narrow array-cast normalization above matched exactly 18 CHECK arrays
and one index array on each side; after those rewrites every complete definition matched byte for
byte. No other text was changed: literals, operators, column casts, index keys, and partial
predicates, including the active-row `marked_as_deleted = false` predicates, remained in the
comparison. Trigger definitions and function bodies matched directly without normalization.

A read-only source aggregate immediately after cleanup found 4,044 `enc:v1:` envelopes across 33
text columns. Combined with the exact captured-archive/restored-data comparison performed before
the isolated application boot, this makes the encryption bootstrap check non-vacuous; no envelope
or plaintext value was output.

The rehearsal exposed and corrected two procedure errors: PostgreSQL 18 requires the volume mount
at `/var/lib/postgresql`, and `pg_restore` requires explicit `--create`. All disposable containers,
the network, volume, environment material, dumps, and comparison files were removed afterward.

This proves one logical backup could be restored on the same Docker engine and exact development
images at that point in time. It does not prove scheduled backups, retention, encrypted off-host or
immutable storage, restore on replacement infrastructure, credential/key escrow retrieval,
operator access, recovery time or recovery point objectives, physical backup recovery,
point-in-time recovery/WAL replay, production-scale performance, or a production disaster-recovery
cutover. Do not describe the deployment as production-DR-ready based on this rehearsal.
