### Persistence

PostgreSQL is the only database. Connection settings come from the `postgres:` block in `application.yaml` (env-overridable via `POSTGRES_JDBC_URL`, `POSTGRES_R2DBC_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`); defaults match the `docker compose up postgres` service. There is one persistence stack:

- **Flyway** (`infra/db/Flyway.kt`) — runs schema migrations from `server/src/main/resources/db/migration/` at startup via the Java API, opening a short-lived JDBC connection. Migrations are the single source of truth for schema; do not call `SchemaUtils.create` anywhere.
- **Exposed + R2DBC** (`infra/db/Database.kt` + `users/UserService.kt`) — runtime DB access. `Database.kt` connects the `R2dbcDatabase` and publishes `UserServiceKey`; the service itself lives next to the feature it serves. The Exposed table objects (e.g. `UserService.Users`) are used for queries only, not DDL.

The `org.postgresql:postgresql` JDBC driver is on the classpath solely for Flyway; runtime queries go through R2DBC.

**Cross-feature table reads (the service-layer rule).** A feature service MAY query another feature's Exposed table objects directly when the read must run **inside its own transaction** (SQL joins, atomic snapshots — e.g. every service's `Users` name/soft-delete joins, pulse's eligibility snapshot over `UserDisabledFeatures`, reviews ↔ review-periods): calling the other feature's *service* would open a second transaction and break atomicity. Route handlers never touch tables (services only), and the three sanctioned **route-side** compositions stay dashboard/summary, the `/teams/members` enrichment, and the pulse `…/participation-status` assembly — all batched, set-at-a-time, never per-row loops.

**Views behind Exposed objects (v4.17.0/V93).** `TeamService.Teams` (`teams_current`) and `TeamService.TeamMembers` (`team_members`) are read-only VIEWS holding today's manager and today's roster, so every reader keeps its shape; all writes go to the base-table objects `TeamRecords`/`TeamMemberships`/`TeamManagerPeriods` — never insert/update/delete through a view (dates compare with `CURRENT_DATE`, so the pooled session time zone is the JVM's, see "Connection pool").

Current migrations are `V1`–`V95`. **The per-migration catalog lives in `.claude/docs/features/migrations.md`** — read it before adding a migration or reasoning about schema history.

### Connection pool

- **Applies when:** touching `infra/db/Database.kt`'s connect call, the `postgres.pool.*`
  configuration, or reasoning about how many PostgreSQL backends one Lettuce instance can hold.
- **Requirement:** Exposed connects through ONE bounded `io.r2dbc:r2dbc-pool` `ConnectionPool`
  (v3.16.1) wrapping the plain PostgreSQL R2DBC factory — never a raw `r2dbc:postgresql://`
  connect (one backend per `suspendTransaction`, nothing capping concurrency). Bounds come from
  `application.yaml`'s `postgres.pool` block, each boot-validated (startup fails outside the
  range): `maxSize` (`POSTGRES_POOL_MAX_SIZE`, default 20, 1..1000), `initialSize`
  (`POSTGRES_POOL_INITIAL_SIZE`, default 2, 0..maxSize — a lazy floor; `warmup()` is deliberately
  not called), `maxAcquireTimeSeconds` (`POSTGRES_POOL_MAX_ACQUIRE_SECONDS`, default 10, 1..600) and
  `maxIdleTimeSeconds` (`POSTGRES_POOL_MAX_IDLE_SECONDS`, default 600, 1..86400). Every pooled
  connection carries `application_name = lettuce` (count with
  `SELECT count(*) FROM pg_stat_activity WHERE application_name = 'lettuce'`). Size it as
  `maxSize × replicas + 1` (Flyway's short-lived JDBC connection) well under the server's
  `max_connections`. An acquire that waits past the deadline fails with the catch-all's logged
  `500` — deliberately NOT a new declared status. The pool is disposed on `ApplicationStopped`.
  The same config pins `defaultMaxAttempts = 1` (Exposed would otherwise retry any
  `R2dbcException` three times against a one-shot acquire timeout). The Reactor BOM is imported as
  a platform in `server/build.gradle.kts` (move the `reactor-bom` catalog line together with the
  `netty` pin; `:server:checkDependencyAlignment` guards it).
- **Reference:** `infra/db/Database.kt` (`connectPooled`, `readPoolBounds`), `application.yaml`
  `postgres.pool`. The RAW pool is published as `ConnectionPoolKey` (v4.20.0) before `tracedConnectionFactory` may wrap it, so its `metrics` (acquired/idle/pending/allocated) are readable whichever factory Exposed talks through.
  The `tx` count of the `Server-Timing` header ("Per-request DB metrics" in `.claude/docs/observability.md`) is the number of validation round trips a request pays.
- **Enforcement:** `ConnectionPoolTest` — the `maxSize` bound, the acquire timeout, release on stop,
  out-of-range bounds failing startup, the v4.7.1 hung-database bounds and `statement_timeout`.
- **A hung database is bounded (v4.7.1).** The driver has NO socket read timeout, so the bounds are explicit and all boot-validated: `maxValidationTimeSeconds` (`POSTGRES_POOL_MAX_VALIDATION_SECONDS` — every acquire validates with a round trip), `maxCreateConnectionTimeSeconds` (`POSTGRES_POOL_MAX_CREATE_SECONDS`) plus `postgres.connectTimeoutSeconds` (`POSTGRES_CONNECT_TIMEOUT_SECONDS`), and `postgres.statementTimeoutSeconds` (`POSTGRES_STATEMENT_TIMEOUT_SECONDS` — PostgreSQL's `statement_timeout`, set through Exposed's `defaultQueryTimeout`, NOT a driver option). A request waits at most about **2 × `maxAcquireTime`** for a hung database, then fails with the catch-all 500 (`/readyz` answers 503); pinned by `ConnectionPoolTest`. Rationale, ranges, costs and the still-unbounded case: `.claude/docs/persistence-details.md`.
- **Session time zone (v4.17.0).** Every pooled connection runs in the JVM's default zone (`PostgresqlConnectionFactoryProvider.TIME_ZONE`, set explicitly in `connectPooled`): the V93 views compare dated rows with `CURRENT_DATE` while the app's "today" is `LocalDate.now()`, and a Warsaw JVM against a UTC server would otherwise disagree for hours after midnight. Pinned by `ConnectionPoolTest` with a deliberately non-UTC JVM zone.
- **Exception:** the pool sets no `maxLifeTime`; the only background paths that can outlive the
  dispose are the notification mirrors' fire-and-forget dispatches (a late batch logs an ERROR and
  the email or Teams message is simply not sent).
- **Full narrative** (the 2026-09-20 saturation measurement, the lazy-floor and `defaultMaxAttempts`
  rationale, the r2dbc-pool/Reactor alignment, the dispose exception): **MANDATORY read** of
  "Connection pool — full rationale…" in `.claude/docs/persistence-details.md` before changing the pool.

### Consistency model (mutations vs. events & notifications) — deliberate

A business mutation, its history event, and its in-app notifications do **not** share one transaction — by design, not oversight (confirmed and accepted in the 2026-08-10 audit review, AUD-001). The shape, uniform across every event-producing feature: the service method commits the mutation in its own `suspendTransaction` and returns *notification descriptors*; the route then persists each notification (`NotificationService.create`, one transaction per recipient; pulse's org-wide fan-outs use the batch `createAll`) and appends the history event (`EventLog.create`, own transaction), then responds. Consequences, accepted at this app's scale (single instance, small payloads, low contention): a failure after the mutation commit yields a `500` with the state already changed, possibly with partial notification fan-out or a missing history event; a client retry then hits the domain guard (`409`). The email mirror is a further, separately documented best-effort layer after the notification commit. Do **not** "fix" individual routes toward atomicity piecemeal — that would fork the convention; if audit-grade history or multi-instance deployment ever becomes a requirement, revisit wholesale (transaction-aware unit of work or an outbox) as its own project. **System-originated events (v3.11.0/V80):** a history event minted by the server itself (e.g. the feedback expiry sweep's `REQUEST_EXPIRED`) stores `user_id NULL` on the owning `*_events` table, and `EventLog.listFor` LEFT JOINs so it is still listed with a null `userName`. **Per-instance by design:** five mechanisms keep state in memory per replica (the notification and sign-in-history purge throttles, the feedback expiry sweep gates, the Teams token cache, the telemetry delta baselines); replicas mean more sweeps, never fewer, and every one is idempotent. The per-feature enumeration (which `*_events` tables, their keys and nullability, V80–V94) and the per-instance detail: **MANDATORY read** of "Consistency model — the per-feature enumeration" in `.claude/docs/persistence-details.md` before adding an events table or an in-memory per-replica mechanism.

### Soft delete (convention)

The following are **soft-deleted** — rows are flagged `marked_as_deleted`, never physically removed: `users`, `teams`, `templates`, `dictionary_entries`, `feedbacks`, `alerts`, `one_on_one_meetings`, `goals`, `team_kpis`, `performance_reviews`, `days_off_requests`, `days_off_corrections`, `user_career_positions`, `impact_log_entries`, `succession_plans` + `succession_nominations`, `days_off_pool_types` + `days_off_pools` ("archived"), `pulse_cycles` (CANCELLED status is the user-facing removal) and `notifications` (soft-deleted by the user-facing DELETE, but rows that are seen or user-deleted and older than `notifications.retentionDays` are HARD-deleted by the on-mint purge since v3.12.0 — a registered exception). The audit/event trails, join and detail tables, registries and terminal-stamp tables (`integration_clients.revoked_at`, `document_shares.withdrawn_at`) are the **justified exceptions** that hard-delete or never delete; the registered retention purges are `notifications`, `account_events` (sign-in history, 90 days) and the telemetry pair. **The full per-table lists with versions, migrations and rationale: MANDATORY read of "Soft delete — which tables are soft-deleted and which hard-delete" in `.claude/docs/persistence-details.md` before adding a table, an events trail or a purge.** To add soft-delete to a new entity, follow the established pattern (reference implementation: `users/UserService.kt`):

1. **Migration** — `ALTER TABLE <t> ADD COLUMN marked_as_deleted BOOLEAN NOT NULL DEFAULT FALSE;` plus `CREATE INDEX idx_<t>_marked_as_deleted ON <t>(marked_as_deleted);` (see `V7`/`V8`/`V16`/`V17`).
2. **Exposed table** — add `val markedAsDeleted = bool("marked_as_deleted").default(false)` and a private helper `fun active(): Op<Boolean> = <T>.markedAsDeleted eq false`.
3. **Filter every read** — `read`, `list`, `count`, and any lookup (e.g. `findWithIdByEmail`) get `… and active()`. Apply it in the shared list predicate so the `count()` (total) and the row select stay consistent.
4. **`delete` flips the flag** — `update({ (id eq id) and (markedAsDeleted eq false) }) { it[markedAsDeleted] = true }`, returning the affected-row `Int`; guard `update` mutations the same way. The route maps `0 → 404`, so a missing-or-already-deleted row is `404` (not `204`) and delete stays idempotent in effect.
5. **Routes need no special-casing** — they already key `404`/`204`/`NoContent` off the row-count and the `active()`-filtered `read`.

**Freeing a unique business field on delete.** To let a value be reused once its holder is soft-deleted, replace the global `UNIQUE` with a **partial unique index** over active rows: drop the original `<t>_<col>_key` constraint, then `CREATE UNIQUE INDEX uq_<t>_<col>_active ON <t>(<col>) WHERE marked_as_deleted = false;`. Drop the Exposed `.uniqueIndex()` on that column (Exposed defs are query-only — the DB enforces it). A clash with an **active** row still raises `23505 → 409`. The partial indexes in place today (`uq_users_email_active`, `uq_users_unique_id_active`, `uq_templates_name_active`, `uq_dictionary_entries_value_en_active`, the days-off pool-type and grant indexes) are listed in "Soft delete — partial unique indexes in place today" in `.claude/docs/persistence-details.md`. Seeds using `ON CONFLICT (<col>)` keep working because they run on earlier migrations, while the global constraint still exists.
