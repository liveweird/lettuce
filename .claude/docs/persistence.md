### Persistence

PostgreSQL is the only database. Connection settings come from the `postgres:` block in `application.yaml` (env-overridable via `POSTGRES_JDBC_URL`, `POSTGRES_R2DBC_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`); defaults match the `docker compose up postgres` service. There is one persistence stack:

- **Flyway** (`infra/db/Flyway.kt`) — runs schema migrations from `server/src/main/resources/db/migration/` at startup via the Java API, opening a short-lived JDBC connection. Migrations are the single source of truth for schema; do not call `SchemaUtils.create` anywhere.
- **Exposed + R2DBC** (`infra/db/Database.kt` + `users/UserService.kt`) — runtime DB access. `Database.kt` connects the `R2dbcDatabase` and publishes `UserServiceKey`; the service itself lives next to the feature it serves. The Exposed table objects (e.g. `UserService.Users`) are used for queries only, not DDL.

The `org.postgresql:postgresql` JDBC driver is on the classpath solely for Flyway; runtime queries go through R2DBC.

Current migrations are `V1`–`V44`. **The per-migration catalog lives in `.claude/docs/features/migrations.md`** — read it before adding a migration or reasoning about schema history.

### Soft delete (convention)

`users`, `teams`, `templates`, `dictionary_entries`, `notifications`, `feedbacks`, `alerts`, `one_on_one_meetings`, `goals`, `team_kpis`, `performance_reviews`, `days_off_requests`, and `days_off_corrections` are **soft-deleted** — rows are flagged, never physically removed (`days_off_requests` carries the column per convention but has **no DELETE endpoint** — the owner's CANCELLED status is the user-facing removal). Only the join/audit/detail tables (`team_members`, `feedback_events`, `revoked_tokens`, `one_on_one_events`, `goal_events`, `team_kpi_events`, `performance_review_events`, the 1:1 detail tables `one_on_one_notes`/`one_on_one_action_items` — whose rows hard-delete on full-document replace — and the team-KPI data points `team_kpi_values`) hard-delete, plus the `review_periods` and `public_holidays` registries — justified exceptions to the convention: a soft-deleted period would poison the timeline's no-gap rule (see "Performance reviews" in `.claude/docs/features/performance-reviews.md`), and nothing references a holiday by FK while request costs are frozen at creation (see "Days off" in `.claude/docs/features/days-off.md`). (`feedback_events`/`one_on_one_events`/`goal_events`/`performance_review_events` keep their `ON DELETE CASCADE` FKs, but they never fire now — events outlive a soft-deleted parent.) To add soft-delete to a new entity, follow the established pattern (reference implementation: `users/UserService.kt`):

1. **Migration** — `ALTER TABLE <t> ADD COLUMN marked_as_deleted BOOLEAN NOT NULL DEFAULT FALSE;` plus `CREATE INDEX idx_<t>_marked_as_deleted ON <t>(marked_as_deleted);` (see `V7`/`V8`/`V16`/`V17`).
2. **Exposed table** — add `val markedAsDeleted = bool("marked_as_deleted").default(false)` and a private helper `fun active(): Op<Boolean> = <T>.markedAsDeleted eq false`.
3. **Filter every read** — `read`, `list`, `count`, and any lookup (e.g. `findByEmail`) get `… and active()`. Apply it in the shared list predicate so the `count()` (total) and the row select stay consistent.
4. **`delete` flips the flag** — `update({ (id eq id) and (markedAsDeleted eq false) }) { it[markedAsDeleted] = true }`, returning the affected-row `Int`; guard `update` mutations the same way. The route maps `0 → 404`, so a missing-or-already-deleted row is `404` (not `204`) and delete stays idempotent in effect.
5. **Routes need no special-casing** — they already key `404`/`204`/`NoContent` off the row-count and the `active()`-filtered `read`.

**Freeing a unique business field on delete.** To let a value be reused once its holder is soft-deleted, replace the global `UNIQUE` with a **partial unique index** over active rows: drop the original `<t>_<col>_key` constraint, then `CREATE UNIQUE INDEX uq_<t>_<col>_active ON <t>(<col>) WHERE marked_as_deleted = false;`. Drop the Exposed `.uniqueIndex()` on that column (Exposed defs are query-only — the DB enforces it). A clash with an **active** row still raises `23505 → 409`. In place today: `users.email` (`uq_users_email_active`, `V18`), `templates.name` (`uq_templates_name_active`, `V16`), and per-dictionary `dictionary_entries.value` (`uq_dictionary_entries_value_active` on `(dictionary, value)`, `V31`). Seeds using `ON CONFLICT (<col>)` keep working because they run on earlier migrations, while the global constraint still exists.

