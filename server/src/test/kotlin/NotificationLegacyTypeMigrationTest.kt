package ch.nokillswit

import java.sql.DriverManager
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.flywaydb.core.Flyway

/**
 * `V83` — the rows v3.9.0 orphaned (v3.25.3).
 *
 * v3.9.0 removed seven `NotificationType` values but its `V77` rewrote only `days_off_requests`,
 * leaving `notifications.notification_type` holding names no later build can decode: every
 * upgraded database 500-ed the recipient's whole notification list. This pins the conversion on a
 * throwaway schema — the `DaysOffPoolTest` V74 precedent — because the suite's own container is
 * already fully migrated, so the rewrite can only be observed by replaying it from `V82`.
 *
 * The mapping under test mirrors what `V77` did to the underlying entry: the kinds whose entry it
 * kept become `DAYS_OFF_CREATED`, the kinds whose entry it soft-deleted become `DAYS_OFF_DELETED`.
 */
class NotificationLegacyTypeMigrationTest {

    /** Every row as (type, params), for the before/after comparison. */
    private fun notificationRows(conn: java.sql.Connection): List<Pair<String, String>> =
        conn.createStatement().use { st ->
            st.executeQuery("SELECT notification_type, params FROM notifications ORDER BY id").use { rs ->
                buildList { while (rs.next()) add(rs.getString(1) to rs.getString(2)) }
            }
        }

    /** V83's own statements, read from the migration file — never a copy that could drift. */
    private fun migrationStatements(): List<String> =
        checkNotNull(javaClass.getResource("/db/migration/V83__notifications_retire_days_off_lifecycle_types.sql"))
            .readText()
            .lineSequence()
            .filterNot { it.trimStart().startsWith("--") }
            .joinToString("\n")
            .split(";")
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .also { check(it.size == 2) { "expected V83 to hold two statements, found ${it.size}" } }

    /** A pre-v3.9.0 notification row, inserted under the schema's own `users` row. */
    private fun legacyNotification(type: String, params: String, email: String): String =
        "INSERT INTO notifications (recipient_id, created_at, notification_type, params, link, was_seen) " +
            "SELECT id, 0, '$type', '$params', '/days-off?tab=team', false FROM users WHERE email = '$email'"

    @Test
    fun `V83 converts every orphaned days-off notification type and reshapes its params`() {
        val schema = "v83_check_" + UUID.randomUUID().toString().replace("-", "").take(8)
        fun flyway(target: String?) = Flyway.configure()
            .dataSource(PostgresTestSupport.jdbcUrl, PostgresTestSupport.user, PostgresTestSupport.password)
            .locations("classpath:db/migration")
            .schemas(schema)
            .apply { if (target != null) target(target) }
            .load()
        // A throwaway schema migrated to V82 — the state an instance upgrading past v3.9.0 is in.
        flyway("82").migrate()
        DriverManager.getConnection(PostgresTestSupport.jdbcUrl, PostgresTestSupport.user, PostgresTestSupport.password).use { conn ->
            try {
                conn.createStatement().use { it.execute("SET search_path TO $schema") }
                conn.createStatement().use { st ->
                    st.execute(
                        "INSERT INTO users (name, email, password_hash) VALUES ('Legacy Owner', 'legacy-owner@x', 'h')",
                    )
                    // The _TO_MANAGER kinds name the owner in `requester`; the _TO_OWNER kinds do
                    // not — there the recipient IS the owner, so the name comes from the join.
                    st.execute(
                        legacyNotification(
                            "DAYS_OFF_REQUESTED_TO_MANAGER",
                            """{"requester":"AAA One","type":"PAID","pool":"Paid days off",""" +
                                """"days":"2","startDate":"2070-05-04","endDate":"2070-05-05"}""",
                            "legacy-owner@x",
                        ),
                    )
                    st.execute(
                        legacyNotification(
                            "DAYS_OFF_ACCEPTED_TO_OWNER",
                            """{"manager":"Manager AAA","startDate":"2070-05-08","endDate":"2070-05-09"}""",
                            "legacy-owner@x",
                        ),
                    )
                    st.execute(
                        legacyNotification(
                            "DAYS_OFF_CANCELLED_TO_MANAGER",
                            """{"requester":"AAA Three","manager":"Manager AAA","by":"MANAGER",""" +
                                """"startDate":"2070-05-13","endDate":"2070-05-14"}""",
                            "legacy-owner@x",
                        ),
                    )
                    // No dates to carry over: deliberately left behind for `knownType()` to hide,
                    // rather than converted into a row that would render "Invalid Date".
                    st.execute(
                        legacyNotification("DAYS_OFF_REJECTED_TO_OWNER", """{"manager":"Manager AAA"}""", "legacy-owner@x"),
                    )
                    // Params that are not JSON at all. Nothing writes this today, but a failed
                    // migration refuses startup on every replica — far worse than the per-request
                    // 500 being fixed — so the guard is pinned rather than assumed.
                    st.execute(legacyNotification("DAYS_OFF_CANCELLED_TO_OWNER", "not json at all", "legacy-owner@x"))
                }

                flyway(null).migrate()

                conn.createStatement().use { st ->
                    st.executeQuery(
                        "SELECT notification_type, params FROM notifications ORDER BY id",
                    ).use { rs ->
                        assertTrue(rs.next())
                        // V77 kept a REQUESTED entry as an active entry, so its note becomes CREATED.
                        assertEquals("DAYS_OFF_CREATED", rs.getString("notification_type"))
                        assertEquals(
                            """{"person": "AAA One", "endDate": "2070-05-05", "startDate": "2070-05-04"}""",
                            rs.getString("params"),
                        )

                        assertTrue(rs.next())
                        // ACCEPTED likewise — and `person` had to come from the users join.
                        assertEquals("DAYS_OFF_CREATED", rs.getString("notification_type"))
                        assertEquals(
                            """{"person": "Legacy Owner", "endDate": "2070-05-09", "startDate": "2070-05-08"}""",
                            rs.getString("params"),
                        )

                        assertTrue(rs.next())
                        // V77 soft-deleted a CANCELLED entry, so its note becomes DELETED. The
                        // v3.2.1 redaction rule holds by construction: no `type`, no `pool`, no `by`.
                        assertEquals("DAYS_OFF_DELETED", rs.getString("notification_type"))
                        assertEquals(
                            """{"person": "AAA Three", "endDate": "2070-05-14", "startDate": "2070-05-13"}""",
                            rs.getString("params"),
                        )

                        assertTrue(rs.next())
                        assertEquals("DAYS_OFF_REJECTED_TO_OWNER", rs.getString("notification_type"))
                        assertEquals("""{"manager":"Manager AAA"}""", rs.getString("params"))

                        assertTrue(rs.next())
                        // The migration completed AT ALL with this row present — that is the
                        // assertion — and left it for `knownType()` rather than dying on the cast.
                        assertEquals("DAYS_OFF_CANCELLED_TO_OWNER", rs.getString("notification_type"))
                        assertEquals("not json at all", rs.getString("params"))
                        assertFalse(rs.next())
                    }
                }

                // Genuinely idempotent: re-execute the migration's OWN statements and assert the
                // table is byte-identical afterwards. Flyway would skip an applied migration by
                // checksum, so this exercises what that skip protects — the SQL's self-exclusion
                // (a converted row no longer matches the IN list), which is what makes a
                // hand-patched database, or a re-run under a different tool, safe.
                val before = notificationRows(conn)
                for (statement in migrationStatements()) {
                    conn.createStatement().use { it.execute(statement) }
                }
                assertEquals(before, notificationRows(conn), "re-running V83 changed rows")
            } finally {
                conn.createStatement().use { it.execute("DROP SCHEMA IF EXISTS $schema CASCADE") }
            }
        }
    }
}
