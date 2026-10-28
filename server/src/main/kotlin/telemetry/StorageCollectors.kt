package ch.nokillswit.telemetry

/**
 * The storage groups the database section reports, HAND-LISTED: every base table of the `public` schema except Flyway's own history
 * belongs to exactly one group (`StorageCollectorsTest` fails when a migration adds a table that is in none, or lists one twice),
 * so a group's size is the sum of its tables' `pg_total_relation_size` (heap, TOAST and indexes). The `teams_current` and
 * `team_members` views (V93) are no relations of kind r/m, so they are in no group by construction. The group names are only map
 * lookups and labels; no SQL text is built from them.
 */
internal val STORAGE_GROUPS: Map<String, List<String>> = linkedMapOf(
    "people" to listOf(
        "users", "user_roles", "user_disabled_features", "user_notification_preferences", "user_teams_identities",
        "user_career_positions", "career_position_events", "account_events", "revoked_tokens", "login_lockouts",
        "password_reset_requests", "mfa_challenges", "integration_clients",
    ),
    "teams" to listOf("teams", "team_memberships", "team_manager_periods", "team_structure_events"),
    "feedback" to listOf("feedbacks", "feedback_subjects", "feedback_events", "impact_log_entries", "impact_log_events"),
    "meetings" to listOf("one_on_one_meetings", "one_on_one_notes", "one_on_one_action_items", "one_on_one_events"),
    "goals" to listOf("goals", "goal_milestones", "goal_events", "team_kpis", "team_kpi_values", "team_kpi_events"),
    "reviews" to listOf(
        "performance_reviews", "performance_review_events", "review_periods", "succession_plans", "succession_nominations",
        "succession_nomination_goals", "succession_plan_events",
    ),
    "days_off" to listOf(
        "days_off_requests", "days_off_corrections", "days_off_pool_types", "days_off_pools", "days_off_events", "public_holidays",
    ),
    "pulse" to listOf("pulse_cycles", "pulse_participants", "pulse_responses"),
    "platform" to listOf(
        "notifications", "document_shares", "templates", "dictionary_entries", "alerts", "app_settings", "telemetry_processes",
        "telemetry_samples",
    ),
)

/** The table Flyway keeps its own history in: in no storage group (it is not application data). */
internal const val FLYWAY_TABLE = "flyway_schema_history"

/**
 * One counted table: its `db.rows` is the non-deleted rows (`NOT marked_as_deleted`; a deactivated user still counts) - or, when
 * [activeOnly] is false, all of them: retained history and observations, where the stored size is the point (a soft-deleted
 * notification is still stored until its retention purge). The counted tables are the ones an admin can see growing.
 */
internal class CountedTable(val name: String, val activeOnly: Boolean)

internal val COUNTED_TABLES: List<CountedTable> = listOf(
    CountedTable("users", activeOnly = true),
    CountedTable("teams", activeOnly = true),
    CountedTable("feedbacks", activeOnly = true),
    CountedTable("one_on_one_meetings", activeOnly = true),
    CountedTable("goals", activeOnly = true),
    CountedTable("team_kpis", activeOnly = true),
    CountedTable("performance_reviews", activeOnly = true),
    CountedTable("days_off_requests", activeOnly = true),
    CountedTable("impact_log_entries", activeOnly = true),
    CountedTable("succession_plans", activeOnly = true),
    CountedTable("pulse_responses", activeOnly = false),
    CountedTable("notifications", activeOnly = false),
    CountedTable("document_shares", activeOnly = false),
    CountedTable("telemetry_samples", activeOnly = false),
)

/** A belt-and-braces check on the one thing interpolated into SQL: a [COUNTED_TABLES] name, never input. */
private val IDENTIFIER = Regex("[a-z][a-z0-9_]*")

private fun sqlIdentifier(name: String): String {
    require(IDENTIFIER.matches(name)) { "not a plain table name: $name" }
    return name
}

/**
 * The database section's readings: `db.size` (`pg_database_size`), `db.group.size` per [STORAGE_GROUPS] entry and `db.rows` per
 * [COUNTED_TABLES] entry. The only identifiers interpolated into SQL are the fixed [COUNTED_TABLES] names, each guarded by
 * [sqlIdentifier]'s plain-name check - never input. Catalog sizes plus `count(*)` only - no table's content column is ever
 * selected (a count never touches the encrypted columns), and it needs no feature package's service. Every statement runs in a
 * transaction of its own (see [HeavyReader]).
 */
internal suspend fun HeavyReader.storageReadings(): List<Reading> {
    val total = read { query("SELECT pg_database_size(current_database())") { it.get(0, Long::class.javaObjectType) ?: 0L }.single() }
    val sizes = read {
        query(
            """
            SELECT c.relname, pg_total_relation_size(c.oid)::bigint
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'm')
            """.trimIndent(),
        ) { it.get(0, String::class.java).orEmpty() to (it.get(1, Long::class.javaObjectType) ?: 0L) }.toMap()
    }
    val groups = STORAGE_GROUPS.map { (group, tables) ->
        Reading(TelemetryMetrics.DB_GROUP_SIZE, tables.sumOf { sizes[it] ?: 0L }.toDouble(), group)
    }
    val rows = COUNTED_TABLES.map { table ->
        val where = if (table.activeOnly) " WHERE NOT marked_as_deleted" else ""
        val count = read {
            val sql = "SELECT count(*)::bigint FROM ${sqlIdentifier(table.name)}$where"
            query(sql) { it.get(0, Long::class.javaObjectType) ?: 0L }.single()
        }
        Reading(TelemetryMetrics.DB_ROWS, count.toDouble(), table.name)
    }
    return listOf(Reading(TelemetryMetrics.DB_SIZE, total.toDouble())) + groups + rows
}
