package ch.nokillswit

import ch.nokillswit.feedbacks.Feedback
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.telemetry.COUNTED_TABLES
import ch.nokillswit.telemetry.FLYWAY_TABLE
import ch.nokillswit.telemetry.HeavyReader
import ch.nokillswit.telemetry.Reading
import ch.nokillswit.telemetry.STORAGE_GROUPS
import ch.nokillswit.telemetry.TelemetryMetrics
import ch.nokillswit.telemetry.query
import ch.nokillswit.telemetry.storageReadings
import kotlinx.coroutines.runBlocking
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * `telemetry/StorageCollectors.kt` over the shared container: the hand-listed groups cover every `public` base table (relkind r/m
 * of `pg_class`, so the V93 `teams_current`/`team_members` views are out by construction) exactly once - a migration that adds a
 * table fails here until it is assigned - the sizes are the catalog's, and `db.rows` equals an independent `count(*)` with
 * soft-deleted rows excluded, read by SQL of the test's own, not through the collector.
 */
class StorageCollectorsTest {
    private val reader = HeavyReader(telemetryStore())

    private suspend fun publicRelations(kinds: String): List<String> = suspendTransaction(TestServices.database) {
        query(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
                "WHERE n.nspname = 'public' AND c.relkind IN ($kinds)",
        ) { it.get(0, String::class.java).orEmpty() }
    }

    /** Base tables and materialized views, as the collector measures them (Flyway's own history excluded). */
    private suspend fun publicTables(): List<String> = publicRelations("'r', 'm'").filterNot { it == FLYWAY_TABLE }

    private suspend fun independentCount(table: String, activeOnly: Boolean): Long = suspendTransaction(TestServices.database) {
        val where = if (activeOnly) " WHERE marked_as_deleted = FALSE" else ""
        query("SELECT count(*)::bigint FROM $table$where") { it.get(0, Long::class.javaObjectType) ?: 0L }.single()
    }

    private suspend fun rows(): Map<String, Long> =
        reader.storageReadings().filter { it.metric == TelemetryMetrics.DB_ROWS }.associate { it.label to it.value.toLong() }

    private fun List<Reading>.of(metric: ch.nokillswit.telemetry.MetricDef) = filter { it.metric == metric }

    @Test
    fun `every public table is in exactly one storage group`() = runBlocking {
        val tables = publicTables()
        val grouped = STORAGE_GROUPS.values.flatten()
        assertEquals(emptyList(), tables - grouped.toSet(), "a table is in no group: assign it in StorageCollectors.kt")
        assertEquals(emptyList(), grouped.groupingBy { it }.eachCount().filterValues { it > 1 }.keys.toList(), "a table is in two groups")
        assertEquals(emptyList(), grouped - tables.toSet(), "a group names a table that does not exist")
        assertTrue(FLYWAY_TABLE !in grouped)
    }

    @Test
    fun `the team views are no storage relations`() = runBlocking {
        assertEquals(listOf("team_members", "teams_current"), publicRelations("'v'").filter { it.startsWith("team") }.sorted())
        val grouped = STORAGE_GROUPS.values.flatten().toSet()
        assertTrue("team_members" !in grouped && "teams_current" !in grouped, "views hold no storage; their base tables are grouped")
    }

    @Test
    fun `the groups are the nine feature areas`() {
        assertEquals(
            listOf("people", "teams", "feedback", "meetings", "goals", "reviews", "days_off", "pulse", "platform"),
            STORAGE_GROUPS.keys.toList(),
        )
        assertEquals(
            listOf(
                "users", "teams", "feedbacks", "one_on_one_meetings", "goals", "team_kpis", "performance_reviews", "days_off_requests",
                "impact_log_entries", "succession_plans", "pulse_responses", "notifications", "document_shares", "telemetry_samples",
            ),
            COUNTED_TABLES.map { it.name },
        )
    }

    @Test
    fun `every counted table is a grouped table, and only plain names are ever interpolated`() {
        val grouped = STORAGE_GROUPS.values.flatten().toSet()
        assertEquals(emptyList(), COUNTED_TABLES.map { it.name }.filterNot { it in grouped }, "a counted table is in no storage group")
        assertEquals(COUNTED_TABLES.size, COUNTED_TABLES.map { it.name }.toSet().size, "a table is counted twice")
        assertTrue(COUNTED_TABLES.all { Regex("[a-z][a-z0-9_]*").matches(it.name) })
    }

    @Test
    fun `the readings carry the database size and one size per group`() = runBlocking {
        val readings = reader.storageReadings()
        val database = readings.of(TelemetryMetrics.DB_SIZE).single()
        assertEquals("", database.label)
        val groups = readings.of(TelemetryMetrics.DB_GROUP_SIZE)
        assertEquals(STORAGE_GROUPS.keys.toList(), groups.map { it.label })
        assertTrue(groups.all { it.value > 0.0 }, "every group holds relations with at least an index page: $groups")
        assertTrue(groups.sumOf { it.value } <= database.value, "the groups are part of the database")
    }

    @Test
    fun `row counts equal an independent count of the active rows`() = runBlocking {
        val counted = rows()
        assertEquals(COUNTED_TABLES.map { it.name }.toSet(), counted.keys)
        for (table in COUNTED_TABLES) {
            assertEquals(independentCount(table.name, table.activeOnly), counted.getValue(table.name), table.name)
        }
    }

    @Test
    fun `soft-deleted rows are not counted and the append-only tables count every row`() = runBlocking {
        val before = rows()
        val provider = TestUsers.seed(uniqueEmail("storage-provider"), "pw")
        val subject = TestUsers.seed(uniqueEmail("storage-subject"), "pw")
        val feedback = TestServices.feedbacks.create(
            Feedback(
                subjectId = subject,
                providerId = provider,
                visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                status = FeedbackStatus.DRAFT,
                content = "storage count",
            ),
        )
        TestNotifications.seed(subject)

        val during = rows()
        assertEquals(before.getValue("users") + 2, during.getValue("users"))
        assertEquals(before.getValue("feedbacks") + 1, during.getValue("feedbacks"))
        assertEquals(before.getValue("notifications") + 1, during.getValue("notifications"))

        assertEquals(1, TestServices.feedbacks.delete(feedback.id))
        assertEquals(1, TestServices.users.delete(provider))
        val after = rows()
        assertEquals(before.getValue("feedbacks"), after.getValue("feedbacks"))
        assertEquals(before.getValue("users") + 1, after.getValue("users"))
        assertEquals(before.getValue("notifications") + 1, after.getValue("notifications"), "notifications count every stored row")
        assertTrue(independentCount("feedbacks", activeOnly = false) > after.getValue("feedbacks"), "the soft-deleted row is still stored")
        assertTrue(independentCount("users", activeOnly = false) > after.getValue("users"))
    }
}
