### Persistence

PostgreSQL is the only database. Connection settings come from the `postgres:` block in `application.yaml` (env-overridable via `POSTGRES_JDBC_URL`, `POSTGRES_R2DBC_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`); defaults match the `docker compose up postgres` service. There is one persistence stack:

- **Flyway** (`infra/db/Flyway.kt`) — runs schema migrations from `server/src/main/resources/db/migration/` at startup via the Java API, opening a short-lived JDBC connection. Migrations are the single source of truth for schema; do not call `SchemaUtils.create` anywhere.
- **Exposed + R2DBC** (`infra/db/Database.kt` + `users/UserService.kt`) — runtime DB access. `Database.kt` connects the `R2dbcDatabase` and publishes `UserServiceKey`; the service itself lives next to the feature it serves. The Exposed table objects (e.g. `UserService.Users`) are used for queries only, not DDL.

The `org.postgresql:postgresql` JDBC driver is on the classpath solely for Flyway; runtime queries go through R2DBC.

**Cross-feature table reads (the service-layer rule).** A feature service MAY query another feature's Exposed table objects directly when the read must run **inside its own transaction** (SQL joins, atomic snapshots — e.g. every service's `Users` name/soft-delete joins, pulse's eligibility snapshot over `UserDisabledFeatures`, reviews ↔ review-periods): calling the other feature's *service* would open a second transaction and break atomicity. Route handlers never touch tables (services only), and the three sanctioned **route-side** compositions stay dashboard/summary, the `/teams/members` enrichment, and the pulse `…/participation-status` assembly — all batched, set-at-a-time, never per-row loops.

Current migrations are `V1`–`V85`. **The per-migration catalog lives in `.claude/docs/features/migrations.md`** — read it before adding a migration or reasoning about schema history.

### Connection pool

- **Applies when:** touching `infra/db/Database.kt`'s connect call, the `postgres.pool.*`
  configuration, or reasoning about how many PostgreSQL backends one Lettuce instance can hold.
- **Requirement:** Exposed connects through ONE bounded `io.r2dbc:r2dbc-pool` `ConnectionPool`
  (v3.16.1, ported from Toadie 2.11.2) wrapping the plain PostgreSQL R2DBC factory — never a raw
  `r2dbc:postgresql://` connect, which opens one backend per `suspendTransaction` with nothing
  capping concurrency (measured 2026-09-20 on the compose stack: 120 parallel
  `GET /api/v1/teams/members?view=managed&includeIndirect=true` → ALL 100 backends of PostgreSQL's
  default `max_connections` taken, 6 × `500` "sorry, too many clients already" and 7 × `401` —
  the JWT validation's blocklist read failed and surfaced as an invalid token — fixed in v3.16.2: a throwing blocklist lookup now answers the catch-all's 500, never 401). Bounds come from
  `application.yaml`'s `postgres.pool` block, each boot-validated (startup fails outside the
  range, the `security.lockout.*` idiom): `maxSize` (`POSTGRES_POOL_MAX_SIZE`, default 20,
  1..1000), `initialSize` (`POSTGRES_POOL_INITIAL_SIZE`, default 2, 0..maxSize — the floor the pool
  fills up to on its FIRST acquire, not at construction: r2dbc-pool warms up lazily and
  `warmup()` is deliberately not called; in practice `configureBootstrap`'s backfill
  transactions acquire during boot, so the floor is open before the first request),
  `maxAcquireTimeSeconds` (`POSTGRES_POOL_MAX_ACQUIRE_SECONDS`, default 10, 1..600) and
  `maxIdleTimeSeconds` (`POSTGRES_POOL_MAX_IDLE_SECONDS`, default 600, 1..86400). Every pooled
  connection carries `application_name = lettuce` (`postgres.pool.applicationName`, test-only
  override), so operators count this instance's backends with
  `SELECT count(*) FROM pg_stat_activity WHERE application_name = 'lettuce'`. Size it as
  `maxSize × replicas + 1` (Flyway's short-lived JDBC connection, `infra/db/Flyway.kt`) well under
  the server's `max_connections`. A caller that waits past the acquire deadline fails with the
  pool's timeout exception, which `plugins/ErrorHandling.kt`'s catch-all renders as a logged
  `500` — deliberately NOT a new declared status, since the OpenAPI conformance gate would need
  it on every operation. The pool is disposed on `ApplicationStopped`, so every `testApplication`
  the suite boots (~800 per JVM against one Testcontainer) releases its connections. Exposed's
  `R2dbcDatabase.connect(connectionFactory, databaseConfig)` derives the dialect from
  `databaseConfig.connectionFactoryOptions` alone, so the parsed options (still
  `driver=postgresql`) are threaded into the config unchanged while traffic goes through the
  pool. The same config pins `defaultMaxAttempts = 1`: Exposed would otherwise retry ANY
  `R2dbcException` three times, and the pool's acquire timeout is one — a saturated pool would
  cost 3 × the acquire budget per request and re-enter the acquire queue each time; Lettuce's
  writes serialize on the atomic `reserveAttempt` upsert and `pg_advisory_xact_lock`, never on
  serialization failures, so no code path relied on the retry. **Dependency alignment:**
  r2dbc-pool 1.0.2 declares reactor-pool 1.0.8 (built on reactor-core 3.5.20), but Lettuce
  resolves reactor-core 3.8.7, so `server/build.gradle.kts` imports the Reactor BOM 2025.0.7 as a
  platform (checkup #37 C4) — it pins reactor-core 3.8.7, reactor-pool 1.2.7 and reactor-netty
  1.3.7 as one release train, and `:server:checkDependencyAlignment` fails when any reactor module
  resolves to a version other than the BOM's. Move the `reactor-bom` catalog line together with
  the `netty` pin.
- **Reference:** `infra/db/Database.kt` (`connectPooled`, `readPoolBounds`), `application.yaml`
  `postgres.pool`.
- **Enforcement:** `ConnectionPoolTest` — concurrent transactions never exceed `maxSize` in
  `pg_stat_activity`, a saturated pool times out an acquire instead of hanging, the pool releases
  every connection when the application stops (also when a later module refuses startup), and
  out-of-range bounds fail startup.
- **Exception:** the pool runs r2dbc-pool's defaults for liveness (`ValidationDepth.LOCAL`, no
  `maxLifeTime`): a connection killed server-side between uses is handed out once and fails that
  request with a 500 — accepted until a deployment introduces an idle killer or proxy. The
  background paths that can outlive the dispose are the two notification mirrors'
  fire-and-forget dispatches — `NotificationEmailer`'s and, since v4.5.0,
  `NotificationTeamsSender`'s (launched on the Application scope, off the request path): a batch
  still running at `ApplicationStopped` fails its next pooled read against the disposed pool,
  which its blanket catch logs as an ERROR — the email or Teams message is simply not sent;
  nothing reaches a client.

### Consistency model (mutations vs. events & notifications) — deliberate

A business mutation, its history event, and its in-app notifications do **not** share one transaction — by design, not oversight (confirmed and accepted in the 2026-08-10 audit review, AUD-001). The shape, uniform across the event-producing features (feedbacks, 1:1s, goals, team KPIs, reviews, the impact log, and — events only, no notifications — succession plans): the service method commits the mutation in its own `suspendTransaction` and returns *notification descriptors*; the route then persists each notification (`NotificationService.create`, one transaction per recipient; pulse's org-wide fan-outs use the batch `createAll`) and appends the history event (`EventLog.create`, own transaction), then responds. Consequences, accepted at this app's scale (single instance, small payloads, low contention): a failure after the mutation commit yields a `500` with the state already changed, possibly with partial notification fan-out or a missing history event; a client retry then hits the domain guard (`409`). The email mirror is a further, separately documented best-effort layer after the notification commit. Do **not** "fix" individual routes toward atomicity piecemeal — that would fork the convention; if audit-grade history or multi-instance deployment ever becomes a requirement, revisit wholesale (transaction-aware unit of work or an outbox) as its own project. **System-originated events (v3.11.0/V80):** a history event minted by the server itself rather than a caller (e.g. the feedback expiry sweep's `REQUEST_EXPIRED`) stores `user_id NULL` on the owning `*_events` table — all seven are nullable since V80 — rather than being attributed to a party for schema reasons; `EventLog.listFor` LEFT JOINs so a null-actor row is still listed, with a null resolved `userName`.

### Soft delete (convention)

`users`, `teams`, `templates`, `dictionary_entries`, `notifications` (soft-deleted by the user-facing DELETE; **since v3.12.0 rows that are seen or user-deleted and older than `notifications.retentionDays` are HARD-deleted by the on-mint purge** — the registered exception, see "Retention" in `.claude/docs/features/notifications.md`), `feedbacks`, `alerts`, `one_on_one_meetings`, `goals`, `team_kpis`, `performance_reviews`, `days_off_requests`, `days_off_corrections`, `user_career_positions` (v2.15.0 — its `(user_id, start_date)` uniqueness is a partial index over active rows from day one, so a deleted position frees its start date), `impact_log_entries` (v2.36.0), `succession_plans` + `succession_nominations` (v2.42.0 — the plan's one-OPEN-per-(owner, person) and the per-plan candidate uniqueness are partial indexes over active OPEN/active rows), `days_off_pool_types` + `days_off_pools` (v3.2.0/`V74` — "archived": the kinds registry's active-name and active-default uniqueness, and the grants' active-(user, kind) uniqueness, are partial indexes over active rows; a re-granted pool is a NEW row, its history keyed on the kind — see "Paid pools" in `.claude/docs/features/days-off.md`), and `pulse_cycles` are **soft-deleted** — rows are flagged, never physically removed (`days_off_requests`' column backs its own `DELETE /api/v1/days-off/{id}` since v3.9.0 — the owner or any manager in their transitive chain soft-deletes the entry directly, no approval/status machine involved anymore; `pulse_cycles` instead uses its CANCELLED status as the user-facing removal — the admin never gets a DELETE). Only the join/audit/detail tables (`team_members`, `feedback_events`, `revoked_tokens`, `one_on_one_events`, `goal_events`, `team_kpi_events`, `performance_review_events`, `impact_log_events`, `succession_plan_events` (v2.46.0), the 1:1 detail tables `one_on_one_notes`/`one_on_one_action_items` — whose rows hard-delete on full-document replace — and the goal milestones `goal_milestones` (v2.9.0, the same replace class), and the team-KPI data points `team_kpi_values`, the succession goal links `succession_nomination_goals` (v2.42.0, wholesale-replaced on every nomination PUT — the goal_milestones replace class), the feedback recipients `feedback_subjects` (v3.1.0/`V72` — position-ordered, written once at creation and never updated; `ON DELETE CASCADE` from the soft-deleting parent, so it never fires — see "Multiple recipients" in `.claude/docs/features/feedbacks.md`), the `user_disabled_features` flag rows — wholesale-replaced like `user_roles`, and the `user_notification_preferences` rows (v4.0.0/`V84` — the per-type/per-channel notification switches; wholesale-replaced by their owning PUT, the same shape), and the `user_teams_identities` cache (v4.5.0/`V85` — a resolved Microsoft Teams identity per user, upserted and invalidated on an email change; a cache, not a record) hard-delete, plus the `review_periods` and `public_holidays` registries, the `app_settings` K/V store (config, hard-upsert), the `integration_clients` registry (v3.0.0 — no soft-delete column: `revoked_at` is the terminal user-facing removal, the pulse CANCELLED-status precedent, and rows are never physically removed — the revoked list IS the audit trail), and the pulse pair `pulse_participants` (a frozen eligibility snapshot, like a join table) / `pulse_responses` (never deletable — retained for audit even when the cycle is cancelled, see `.claude/docs/features/pulse-surveys.md`) — justified exceptions to the convention: a soft-deleted period would poison the timeline's no-gap rule (see "Performance reviews" in `.claude/docs/features/performance-reviews.md`), and nothing references a holiday by FK while request costs are frozen at creation (see "Days off" in `.claude/docs/features/days-off.md`). (`feedback_events`/`one_on_one_events`/`goal_events`/`team_kpi_events`/`performance_review_events`/`impact_log_events`/`succession_plan_events` keep their `ON DELETE CASCADE` FKs, but they never fire now — events outlive a soft-deleted parent.) To add soft-delete to a new entity, follow the established pattern (reference implementation: `users/UserService.kt`):

1. **Migration** — `ALTER TABLE <t> ADD COLUMN marked_as_deleted BOOLEAN NOT NULL DEFAULT FALSE;` plus `CREATE INDEX idx_<t>_marked_as_deleted ON <t>(marked_as_deleted);` (see `V7`/`V8`/`V16`/`V17`).
2. **Exposed table** — add `val markedAsDeleted = bool("marked_as_deleted").default(false)` and a private helper `fun active(): Op<Boolean> = <T>.markedAsDeleted eq false`.
3. **Filter every read** — `read`, `list`, `count`, and any lookup (e.g. `findWithIdByEmail`) get `… and active()`. Apply it in the shared list predicate so the `count()` (total) and the row select stay consistent.
4. **`delete` flips the flag** — `update({ (id eq id) and (markedAsDeleted eq false) }) { it[markedAsDeleted] = true }`, returning the affected-row `Int`; guard `update` mutations the same way. The route maps `0 → 404`, so a missing-or-already-deleted row is `404` (not `204`) and delete stays idempotent in effect.
5. **Routes need no special-casing** — they already key `404`/`204`/`NoContent` off the row-count and the `active()`-filtered `read`.

**Freeing a unique business field on delete.** To let a value be reused once its holder is soft-deleted, replace the global `UNIQUE` with a **partial unique index** over active rows: drop the original `<t>_<col>_key` constraint, then `CREATE UNIQUE INDEX uq_<t>_<col>_active ON <t>(<col>) WHERE marked_as_deleted = false;`. Drop the Exposed `.uniqueIndex()` on that column (Exposed defs are query-only — the DB enforces it). A clash with an **active** row still raises `23505 → 409`. In place today: `users.email` (`uq_users_email_active`, `V18`), `days_off_pool_types.name` (`uq_days_off_pool_types_name_active`, `V74` — plus `uq_days_off_pool_types_default` over `is_default` and `days_off_pools(user_id, pool_type_id)` as `uq_days_off_pools_user_type_active`), `users.unique_id` (`uq_users_unique_id_active`, `V59` — a NULLABLE column: NULLs are distinct under the index, so any number of users may have no id), `templates.name` (`uq_templates_name_active`, `V16`), and per-dictionary `dictionary_entries.value_en` (`uq_dictionary_entries_value_en_active`, `V31` split in `V53`, EN-only again since `V60` — non-EN dictionary values live in a JSON `translations` map with validation-level uniqueness, see "Dictionaries" in `.claude/docs/features/dictionaries.md`). Seeds using `ON CONFLICT (<col>)` keep working because they run on earlier migrations, while the global constraint still exists.

