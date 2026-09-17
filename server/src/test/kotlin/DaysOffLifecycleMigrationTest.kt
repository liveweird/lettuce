package ch.nokillswit

import java.sql.DriverManager
import java.util.UUID
import org.flywaydb.core.Flyway
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * V77 (v3.9.0): drops the days-off request/approval lifecycle columns — pins that pre-existing
 * REJECTED/CANCELLED rows are retired (soft-deleted) by the migration while REQUESTED/ACCEPTED
 * rows become plain active entries, and that the `status` column itself is gone afterward (the
 * V74 backfill test's throwaway-schema pattern in `DaysOffPoolTest`).
 */
class DaysOffLifecycleMigrationTest {

    /** A pre-V77 request row (status column still present) for the migration fixture. */
    private fun legacyRequest(status: String, date: String, email: String): String =
        "INSERT INTO days_off_requests " +
            "(user_id, type, status, start_date, end_date, cost_half_days, pool_type_id, created_at, last_modified) " +
            "SELECT id, 'PAID', '$status', '$date', '$date', 2, " +
            "(SELECT id FROM days_off_pool_types WHERE is_default), 0, 0 FROM users WHERE email = '$email'"

    @Test
    fun `V77 soft-deletes REJECTED and CANCELLED rows, keeps REQUESTED and ACCEPTED active, and drops status`() {
        val schema = "v77_check_" + UUID.randomUUID().toString().replace("-", "").take(8)
        fun flyway(target: String?) = Flyway.configure()
            .dataSource(PostgresTestSupport.jdbcUrl, PostgresTestSupport.user, PostgresTestSupport.password)
            .locations("classpath:db/migration")
            .schemas(schema)
            .apply { if (target != null) target(target) }
            .load()
        // A throwaway schema migrated to V76 (the V74 precedent) — `unaccent` is database-wide,
        // so the drop in `finally` never touches the suite's `public` schema.
        flyway("76").migrate()
        DriverManager.getConnection(PostgresTestSupport.jdbcUrl, PostgresTestSupport.user, PostgresTestSupport.password).use { conn ->
            try {
                conn.createStatement().use { it.execute("SET search_path TO $schema") }
                conn.createStatement().use {
                    it.execute(
                        "INSERT INTO users (name, email, password_hash) VALUES " +
                            "('Lifecycle Requested', 'lifecycle-requested@x', 'h')," +
                            "('Lifecycle Accepted', 'lifecycle-accepted@x', 'h')," +
                            "('Lifecycle Rejected', 'lifecycle-rejected@x', 'h')," +
                            "('Lifecycle Cancelled', 'lifecycle-cancelled@x', 'h')",
                    )
                    it.execute(legacyRequest("REQUESTED", "2072-06-01", "lifecycle-requested@x"))
                    it.execute(legacyRequest("ACCEPTED", "2072-06-02", "lifecycle-accepted@x"))
                    it.execute(legacyRequest("REJECTED", "2072-06-03", "lifecycle-rejected@x"))
                    it.execute(legacyRequest("CANCELLED", "2072-06-04", "lifecycle-cancelled@x"))
                }

                flyway(null).migrate()

                conn.createStatement().use { st ->
                    st.executeQuery(
                        "SELECT u.email, r.marked_as_deleted FROM days_off_requests r " +
                            "JOIN users u ON u.id = r.user_id WHERE u.email LIKE 'lifecycle-%' ORDER BY u.email",
                    ).use { rs ->
                        val byEmail = mutableMapOf<String, Boolean>()
                        while (rs.next()) {
                            byEmail[rs.getString("email")] = rs.getBoolean("marked_as_deleted")
                        }
                        assertFalse(byEmail.getValue("lifecycle-accepted@x"), "ACCEPTED stays active")
                        assertFalse(byEmail.getValue("lifecycle-requested@x"), "REQUESTED stays active")
                        assertTrue(byEmail.getValue("lifecycle-rejected@x"), "REJECTED is soft-deleted")
                        assertTrue(byEmail.getValue("lifecycle-cancelled@x"), "CANCELLED is soft-deleted")
                    }
                    st.executeQuery(
                        "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = '$schema' " +
                            "AND table_name = 'days_off_requests' AND column_name = 'status'",
                    ).use { rs ->
                        rs.next()
                        assertEquals(0, rs.getInt(1), "the status column is gone")
                    }
                    st.executeQuery(
                        "SELECT column_name FROM information_schema.columns WHERE table_schema = '$schema' " +
                            "AND table_name = 'days_off_requests' AND column_name IN " +
                            "('resolved_by', 'resolved_at', 'cancelled_at', 'cancelled_by', 'cancel_reason')",
                    ).use { rs ->
                        assertFalse(rs.next(), "the resolved/cancelled columns are gone")
                    }
                }
            } finally {
                conn.createStatement().use { it.execute("DROP SCHEMA IF EXISTS $schema CASCADE") }
            }
        }
    }
}
