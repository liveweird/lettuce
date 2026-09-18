package ch.nokillswit

import java.sql.DriverManager
import java.util.UUID
import org.flywaydb.core.Flyway
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * V80 (v3.11.0): drops `feedback_events.user_id`'s NOT NULL and re-attributes pre-existing
 * REQUEST_EXPIRED rows (the v3.8.0 lazy expiry sweep's NOT-NULL workaround, attributed to the
 * provider only because the column disallowed NULL) to the null system actor — while any other
 * event kind's `user_id` is left untouched. Same throwaway-schema Flyway-target idiom as
 * `DaysOffLifecycleMigrationTest` (the V74 backfill precedent).
 */
class EventsActorMigrationTest {

    @Test
    fun `V80 nulls out REQUEST_EXPIRED user_id and leaves other events' actor untouched`() {
        val schema = "v80_check_" + UUID.randomUUID().toString().replace("-", "").take(8)
        fun flyway(target: String?) = Flyway.configure()
            .dataSource(PostgresTestSupport.jdbcUrl, PostgresTestSupport.user, PostgresTestSupport.password)
            .locations("classpath:db/migration")
            .schemas(schema)
            .apply { if (target != null) target(target) }
            .load()
        // A throwaway schema migrated to V79 (pre-V80) — the DaysOffLifecycleMigrationTest idiom.
        flyway("79").migrate()
        DriverManager.getConnection(PostgresTestSupport.jdbcUrl, PostgresTestSupport.user, PostgresTestSupport.password).use { conn ->
            try {
                conn.createStatement().use { it.execute("SET search_path TO $schema") }
                conn.createStatement().use {
                    it.execute(
                        "INSERT INTO users (name, email, password_hash) VALUES " +
                            "('Events Provider', 'events-provider@x', 'h')," +
                            "('Events Subject', 'events-subject@x', 'h')",
                    )
                    it.execute(
                        "INSERT INTO feedbacks (subject_id, provider_id, visibility, status) " +
                            "SELECT (SELECT id FROM users WHERE email = 'events-subject@x'), " +
                            "(SELECT id FROM users WHERE email = 'events-provider@x'), 'PUBLIC', 'REJECTED'",
                    )
                    // One REQUEST_EXPIRED row (the pre-V80 NOT-NULL workaround) and one ordinary
                    // CREATED row, both stamped against the provider before the migration.
                    it.execute(
                        "INSERT INTO feedback_events (feedback_id, user_id, created_at, event_type, params) " +
                            "SELECT f.id, (SELECT id FROM users WHERE email = 'events-provider@x'), 0, 'REQUEST_EXPIRED', '{}' " +
                            "FROM feedbacks f",
                    )
                    it.execute(
                        "INSERT INTO feedback_events (feedback_id, user_id, created_at, event_type, params) " +
                            "SELECT f.id, (SELECT id FROM users WHERE email = 'events-provider@x'), 0, 'CREATED', '{}' " +
                            "FROM feedbacks f",
                    )
                }

                flyway(null).migrate()

                conn.createStatement().use { st ->
                    st.executeQuery(
                        "SELECT event_type, user_id FROM feedback_events ORDER BY event_type",
                    ).use { rs ->
                        val byType = mutableMapOf<String, Long?>()
                        while (rs.next()) {
                            val userId = rs.getLong("user_id").let { if (rs.wasNull()) null else it }
                            byType[rs.getString("event_type")] = userId
                        }
                        assertNull(byType.getValue("REQUEST_EXPIRED"), "REQUEST_EXPIRED is re-attributed to the system actor")
                        assertEquals(true, byType.getValue("CREATED") != null, "CREATED keeps its original human actor")
                    }
                    st.executeQuery(
                        "SELECT is_nullable FROM information_schema.columns WHERE table_schema = '$schema' " +
                            "AND table_name = 'feedback_events' AND column_name = 'user_id'",
                    ).use { rs ->
                        rs.next()
                        assertEquals("YES", rs.getString("is_nullable"), "user_id is nullable after V80")
                    }
                }
            } finally {
                conn.createStatement().use { it.execute("DROP SCHEMA IF EXISTS $schema CASCADE") }
            }
        }
    }
}
