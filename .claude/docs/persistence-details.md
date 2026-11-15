### Persistence details

The on-demand companion of `.claude/docs/persistence.md` (always loaded).

### A hung database is bounded (v4.7.1)

The driver has NO socket read timeout, so a database that
accepts or holds connections but never answers used to hang requests and `/readyz` forever (an
in-process `withTimeout` cannot cancel the R2DBC handshake — tried and dropped in v4.5.2). The
bounds, all boot-validated:

- **every acquire validates with a round trip** (`ValidationDepth.REMOTE`), bounded by
  `maxValidationTimeSeconds` (`POSTGRES_POOL_MAX_VALIDATION_SECONDS`, default 5, 1..60) — a frozen
  or server-killed connection is discarded instead of handed out (this closed the pre-v4.7.1
  exception where a backend killed server-side was handed out once and failed its request
  with a 500 — for a SINGLE dropped connection: each acquire gets two validation attempts
  (r2dbc-pool's `acquireRetry` default 1, MRU idle order), so after a PostgreSQL restart, when
  every idle connection dies at once, a request whose two picks are both dead still fails fast
  until the pool has refreshed). Cost: one `SELECT 1` round trip per `suspendTransaction`
  (measured 2026-09-30 on the compose stack: +0.3 ms mean / +0.7 ms p95 per request); Exposed's
  per-statement `SET STATEMENT_TIMEOUT` round trip existed before (with 0) and is unchanged;
- **creating a connection** (TCP + startup/auth) is bounded by `maxCreateConnectionTimeSeconds`
  (`POSTGRES_POOL_MAX_CREATE_SECONDS`, default 10, 1..600); the TCP connect alone by
  `postgres.connectTimeoutSeconds` (`POSTGRES_CONNECT_TIMEOUT_SECONDS`, default 10); TCP keepalive on;
- **PostgreSQL's `statement_timeout`** = `postgres.statementTimeoutSeconds`
  (`POSTGRES_STATEMENT_TIMEOUT_SECONDS`, default 30, 0 = off, 0..3600) cancels a statement a LIVE
  but stuck server runs too long. It is set through **Exposed's `defaultQueryTimeout`**, NOT a driver
  option: Exposed's statement executor calls `connection.setStatementTimeout(queryTimeout)` before
  every statement from that default (0), silently overwriting any driver startup option or
  post-allocate `SET` — `ConnectionPoolTest` asserts the value the server reports.

Together a request waits at most about **2 × `maxAcquireTime`** for a hung database (~20 s by
default — r2dbc-pool retries a timed-out acquire once), then fails with the catch-all 500
(`/readyz` answers 503); a cancelled statement (SQLSTATE 57014) is a generic R2dbcException →
the same logged 500, with the transaction rolled back. **Still unbounded:** a query ALREADY in flight when the
network black-holes waits until TCP gives up. Pinned by `ConnectionPoolTest` through
`FreezableRelay` (a TCP relay in front of the Testcontainer that goes silent on demand).

### Connection pool — full rationale, measurements and dependency alignment

Moved verbatim from `.claude/docs/persistence.md` (which keeps the rules). Read it when touching `infra/db/Database.kt`'s connect call, the `postgres.pool.*` configuration, or reasoning about how many PostgreSQL backends one instance can hold.

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
  `postgres.pool`. The RAW pool is published as `ConnectionPoolKey` (v4.20.0) before `tracedConnectionFactory` may wrap it, so its `metrics` (acquired/idle/pending/allocated) are readable whichever factory Exposed talks through.
  The `tx` count of the `Server-Timing` header ("Per-request DB metrics" in `.claude/docs/observability.md`) is the number of validation round trips a request pays.
- **Enforcement:** `ConnectionPoolTest` — concurrent transactions never exceed `maxSize` in
  `pg_stat_activity`, a saturated pool times out an acquire instead of hanging, the pool releases
  every connection when the application stops (also when a later module refuses startup),
  out-of-range bounds fail startup, and (v4.7.1) a frozen database answers `/readyz` 503 within
  the bounds, a server-killed backend is replaced at acquire, and `statement_timeout` reaches the
  server and cancels a longer statement.
- **Exception:** the pool sets no `maxLifeTime` (connections live until idle-recycled). The
  background paths that can outlive the dispose are the two notification mirrors'
  fire-and-forget dispatches — `NotificationEmailer`'s and, since v4.5.0,
  `NotificationTeamsSender`'s (launched on the Application scope, off the request path): a batch
  still running at `ApplicationStopped` fails its next pooled read against the disposed pool,
  which its blanket catch logs as an ERROR — the email or Teams message is simply not sent;
  nothing reaches a client.

### Consistency model — the per-feature enumeration

Moved verbatim from the "Consistency model" section of `.claude/docs/persistence.md` (which keeps the rule: mutation, history event and notifications are separate transactions by design — never "fix" individual routes toward atomicity).

A business mutation, its history event, and its in-app notifications do **not** share one transaction — by design, not oversight (confirmed and accepted in the 2026-08-10 audit review, AUD-001). The shape, uniform across the event-producing features (feedbacks, 1:1s, goals, team KPIs, reviews, the impact log, and — events only; their sole notifications are the content-free share notices — succession plans; and, since v4.9.0, days-off actions and career-position writes — `days_off_events` (V88) and `career_position_events` (V89), both keyed on the PERSON the action concerns, written by the routes after each commit with the existing notification flow unchanged; and — since v4.18.0 — `team_structure_events` (V94), keyed on the TEAM and written by the team routes after each commit (the actor is the admin who acted), and the sign-in history `account_events`, V90, written best-effort by the auth routes — see "Soft delete" below for its retention purge): the service method commits the mutation in its own `suspendTransaction` and returns *notification descriptors*; the route then persists each notification (`NotificationService.create`, one transaction per recipient; pulse's org-wide fan-outs use the batch `createAll`) and appends the history event (`EventLog.create`, own transaction), then responds. Consequences, accepted at this app's scale (single instance, small payloads, low contention): a failure after the mutation commit yields a `500` with the state already changed, possibly with partial notification fan-out or a missing history event; a client retry then hits the domain guard (`409`). The email mirror is a further, separately documented best-effort layer after the notification commit. Do **not** "fix" individual routes toward atomicity piecemeal — that would fork the convention; if audit-grade history or multi-instance deployment ever becomes a requirement, revisit wholesale (transaction-aware unit of work or an outbox) as its own project. **System-originated events (v3.11.0/V80):** a history event minted by the server itself rather than a caller (e.g. the feedback expiry sweep's `REQUEST_EXPIRED`) stores `user_id NULL` on the owning `*_events` table — all seven document tables are nullable since V80 (the person-keyed `days_off_events`, `career_position_events` and `account_events` are nullable from V88/V89/V90 on, and the team-keyed `team_structure_events` from V94) — rather than being attributed to a party for schema reasons; `EventLog.listFor` LEFT JOINs so a null-actor row is still listed, with a null resolved `userName`.

**Per-instance by design.** Five mechanisms keep their state in memory per replica: the notification purge throttle (`NotificationService`), the sign-in history purge throttle (`AccountEventService`), the feedback expiry sweep's `AtomicLong` compare-and-set gates (`FeedbackService.expireOverdueRequests`), the Teams token cache (`TeamsMessenger`) and, since v4.20.0, the telemetry collectors' delta baselines (`LatencyCollector`, `JvmProbe` — each process differences its OWN cumulative counters; the cluster section of a tick is per DATABASE, one holder per bucket under `pg_try_advisory_xact_lock`, `.claude/docs/features/telemetry.md`). Replicas mean more sweeps, never fewer, and every one is idempotent: the purges are `DELETE`s that match nothing once a row is gone, the sweep's `UPDATE … WHERE status = REQUESTED … RETURNING` flips each row for exactly one caller, and a duplicate token fetch is harmless.

### Soft delete — which tables are soft-deleted and which hard-delete

Moved verbatim from the "Soft delete (convention)" section of `.claude/docs/persistence.md` (which keeps the 5-step recipe and the partial-unique-index recipe). The reference implementation stays `users/UserService.kt`.

#### Soft-deleted (flagged, never physically removed)

`users`, `teams`, `templates`, `dictionary_entries`, `notifications` (soft-deleted by the user-facing DELETE; **since v3.12.0 rows that are seen or user-deleted and older than `notifications.retentionDays` are HARD-deleted by the on-mint purge** — the registered exception, see "Retention" in `.claude/docs/features/notifications.md`), `feedbacks`, `alerts`, `one_on_one_meetings`, `goals`, `team_kpis`, `performance_reviews`, `days_off_requests`, `days_off_corrections`, `user_career_positions` (v2.15.0 — its `(user_id, start_date)` uniqueness is a partial index over active rows from day one, so a deleted position frees its start date), `impact_log_entries` (v2.36.0), `succession_plans` + `succession_nominations` (v2.42.0 — the plan's one-OPEN-per-(owner, person) and the per-plan candidate uniqueness are partial indexes over active OPEN/active rows), `days_off_pool_types` + `days_off_pools` (v3.2.0/`V74` — "archived": the kinds registry's active-name and active-default uniqueness, and the grants' active-(user, kind) uniqueness, are partial indexes over active rows; a re-granted pool is a NEW row, its history keyed on the kind — see "Paid pools" in `.claude/docs/features/days-off.md`), and `pulse_cycles` are **soft-deleted** — rows are flagged, never physically removed (`days_off_requests`' column backs its own `DELETE /api/v1/days-off/{id}` since v3.9.0 — the owner or any manager in their transitive chain soft-deletes the entry directly, no approval/status machine involved anymore; `pulse_cycles` instead uses its CANCELLED status as the user-facing removal — the admin never gets a DELETE).

#### Hard-delete / terminal-stamp exceptions (join, audit, detail, registry and retention tables)

Only the join/audit/detail tables (`feedback_events`, `revoked_tokens`, `one_on_one_events`, `goal_events`, `team_kpi_events`, `performance_review_events`, `impact_log_events`, `account_events` (v4.9.0/V90 — the sign-in history: owner = actor = the account; **the one trail that is PURGED — a registered hard-delete exception like `notifications`**: rows older than `activity.accountRetentionDays` (default 90, 0 = forever) are hard-deleted on the write path by `AccountEventService`, throttled by `activity.accountPurgeIntervalSeconds` and launched fire-and-forget on the Application scope, OFF the login request path (a purge still running at shutdown fails against the disposed pool and is logged at ERROR — the `NotificationEmailer` dispose note); see "Sign-in history" in `.claude/docs/security.md`), `days_off_events` (v4.9.0/V88) and `career_position_events` (v4.9.0/V89) — the person-keyed days-off and career-position action trails: append-only, never updated or deleted, forward-only; both FKs to `users` are `RESTRICT` — and `team_structure_events` (v4.18.0/V94), the team-keyed team-structure action trail on the same terms, both FKs `RESTRICT`), `succession_plan_events` (v2.46.0), the 1:1 detail tables `one_on_one_notes`/`one_on_one_action_items` — whose rows hard-delete on full-document replace — and the goal milestones `goal_milestones` (v2.9.0, the same replace class), and the team-KPI data points `team_kpi_values`, the succession goal links `succession_nomination_goals` (v2.42.0, wholesale-replaced on every nomination PUT — the goal_milestones replace class), the feedback recipients `feedback_subjects` (v3.1.0/`V72` — position-ordered, written once at creation and never updated; `ON DELETE CASCADE` from the soft-deleting parent, so it never fires — see "Multiple recipients" in `.claude/docs/features/feedbacks.md`), the `user_disabled_features` flag rows — wholesale-replaced like `user_roles`, and the `user_notification_preferences` rows (v4.0.0/`V84` — the per-type/per-channel notification switches; wholesale-replaced by their owning PUT, the same shape), and the `user_teams_identities` cache (v4.5.0/`V85` — a resolved Microsoft Teams identity per user, upserted and invalidated on an email change; a cache, not a record), and the dated team-structure tables `team_memberships` + `team_manager_periods` (v4.17.0/`V93` — period rows are hard-deleted when removed or when a same-day add is undone, the join class; the `team.*` audit events are the trail) hard-delete, plus the `review_periods` and `public_holidays` registries, the `app_settings` K/V store (config, hard-upsert), the `integration_clients` registry (v3.0.0 — no soft-delete column: `revoked_at` is the terminal user-facing removal, the pulse CANCELLED-status precedent, and rows are never physically removed — the revoked list IS the audit trail), the `document_shares` table (v4.8.0/`V86` — the same terminal-stamp shape: `withdrawn_at`/`withdrawn_by` is the user-facing removal, a re-share is a NEW row, rows are never deleted; status is derived from it and `expires_on`; polymorphic `resource_id` with no FK and a creation-time `details` snapshot — see `.claude/docs/features/sharing.md`), the telemetry pair `telemetry_processes` + `telemetry_samples` (v4.20.0/`V95` — regenerated observations of the process's own vital signs: the sampler's retention hard-deletes raw samples older than 7 days, hourly rollups older than 90 and processes silent for 90, the `notifications`/`account_events` class of registered exception; numbers and labels only — see `.claude/docs/features/telemetry.md`), and the pulse pair `pulse_participants` (a frozen eligibility snapshot, like a join table) / `pulse_responses` (never deletable — retained for audit even when the cycle is cancelled, see `.claude/docs/features/pulse-surveys.md`) — justified exceptions to the convention: a soft-deleted period would poison the timeline's no-gap rule (see "Performance reviews" in `.claude/docs/features/performance-reviews.md`), and nothing references a holiday by FK while request costs are frozen at creation (see "Days off" in `.claude/docs/features/days-off.md`). (`feedback_events`/`one_on_one_events`/`goal_events`/`team_kpi_events`/`performance_review_events`/`impact_log_events`/`succession_plan_events` keep their `ON DELETE CASCADE` FKs, but they never fire now — events outlive a soft-deleted parent.)

### Soft delete — partial unique indexes in place today

Moved verbatim from the "Freeing a unique business field on delete" paragraph of `.claude/docs/persistence.md` (the recipe stays there).

In place today: `users.email` (`uq_users_email_active`, `V18`), `days_off_pool_types.name` (`uq_days_off_pool_types_name_active`, `V74` — plus `uq_days_off_pool_types_default` over `is_default` and `days_off_pools(user_id, pool_type_id)` as `uq_days_off_pools_user_type_active`), `users.unique_id` (`uq_users_unique_id_active`, `V59` — a NULLABLE column: NULLs are distinct under the index, so any number of users may have no id), `templates.name` (`uq_templates_name_active`, `V16`), and per-dictionary `dictionary_entries.value_en` (`uq_dictionary_entries_value_en_active`, `V31` split in `V53`, EN-only again since `V60` — non-EN dictionary values live in a JSON `translations` map with validation-level uniqueness, see "Dictionaries" in `.claude/docs/features/dictionaries.md`). Seeds using `ON CONFLICT (<col>)` keep working because they run on earlier migrations, while the global constraint still exists.
