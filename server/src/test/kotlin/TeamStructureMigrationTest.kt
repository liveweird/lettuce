package ch.nokillswit

import java.sql.Connection
import java.sql.DriverManager
import java.util.UUID
import org.flywaydb.core.Flyway
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * V93 (v4.17.0): the flat `team_members` table and `teams.manager_id` become dated history tables
 * behind two views. Same throwaway-schema Flyway-target idiom as `DaysOffPoolTest` (the V74
 * precedent): migrate a private schema to V92, load a legacy org (a live team, a soft-deleted team
 * with members, a manager who manages two teams), migrate to the head and compare.
 */
class TeamStructureMigrationTest {

    private fun Connection.queryLongs(sql: String): List<Long> =
        createStatement().use { st ->
            st.executeQuery(sql).use { rs -> generateSequence { if (rs.next()) rs.getLong(1) else null }.toList() }
        }

    private fun Connection.exec(sql: String) = createStatement().use { it.execute(sql) }

    @Test
    fun `V93 converts every membership and manager to an open period and keeps the old readers working`() {
        val schema = "v93_check_" + UUID.randomUUID().toString().replace("-", "").take(8)
        fun flyway(target: String?) = Flyway.configure()
            .dataSource(PostgresTestSupport.jdbcUrl, PostgresTestSupport.user, PostgresTestSupport.password)
            .locations("classpath:db/migration")
            .schemas(schema)
            .apply { if (target != null) target(target) }
            .load()
        // A throwaway schema migrated to V92 (`unaccent` is database-wide, so dropping the schema in
        // `finally` never touches the suite's `public` schema).
        flyway("92").migrate()
        DriverManager.getConnection(PostgresTestSupport.jdbcUrl, PostgresTestSupport.user, PostgresTestSupport.password).use { conn ->
            try {
                conn.exec("SET search_path TO $schema")
                conn.exec(
                    "INSERT INTO users (name, email, password_hash) VALUES " +
                        "('Mig Boss', 'mig-boss@x', 'h'), ('Mig Lead', 'mig-lead@x', 'h'), " +
                        "('Mig A', 'mig-a@x', 'h'), ('Mig B', 'mig-b@x', 'h'), ('Mig C', 'mig-c@x', 'h')",
                )
                fun userId(email: String) = conn.queryLongs("SELECT id FROM users WHERE email = '$email'").single()
                val boss = userId("mig-boss@x")
                val lead = userId("mig-lead@x")
                val a = userId("mig-a@x")
                val b = userId("mig-b@x")
                val c = userId("mig-c@x")
                conn.exec("INSERT INTO teams (name, manager_id) VALUES ('Mig Live', $boss), ('Mig Second', $boss), ('Mig Gone', $lead)")
                fun teamId(name: String) = conn.queryLongs("SELECT id FROM teams WHERE name = '$name'").single()
                val live = teamId("Mig Live")
                val second = teamId("Mig Second")
                val gone = teamId("Mig Gone")
                conn.exec("UPDATE teams SET marked_as_deleted = TRUE WHERE id = $gone")
                conn.exec(
                    "INSERT INTO team_members (team_id, user_id) VALUES ($live, $a), ($live, $b), ($second, $a), ($gone, $c)",
                )
                val membersBefore = conn.queryLongs("SELECT count(*) FROM team_members").single()
                val teamsBefore = conn.queryLongs("SELECT count(*) FROM teams").single()

                flyway(null).migrate()

                // team_members is a VIEW now, and shows exactly the legacy rows (open/open = current).
                assertEquals(
                    listOf("VIEW"),
                    conn.createStatement().use { st ->
                        st.executeQuery(
                            "SELECT table_type FROM information_schema.tables " +
                                "WHERE table_schema = '$schema' AND table_name = 'team_members'",
                        ).use { rs -> generateSequence { if (rs.next()) rs.getString(1) else null }.toList() }
                    },
                )
                assertEquals(membersBefore, conn.queryLongs("SELECT count(*) FROM team_members").single())
                assertEquals(listOf(a, b), conn.queryLongs("SELECT user_id FROM team_members WHERE team_id = $live ORDER BY user_id"))

                // One open/open membership per legacy row — the soft-deleted team's row included.
                assertEquals(membersBefore, conn.queryLongs("SELECT count(*) FROM team_memberships").single())
                assertEquals(
                    0L,
                    conn.queryLongs("SELECT count(*) FROM team_memberships WHERE start_date IS NOT NULL OR end_date IS NOT NULL").single(),
                )
                assertEquals(1L, conn.queryLongs("SELECT count(*) FROM team_memberships WHERE team_id = $gone AND user_id = $c").single())

                // One open/open manager period per team, naming the legacy manager.
                assertEquals(teamsBefore, conn.queryLongs("SELECT count(*) FROM team_manager_periods").single())
                assertEquals(
                    0L,
                    conn.queryLongs(
                        "SELECT count(*) FROM team_manager_periods WHERE start_date IS NOT NULL OR end_date IS NOT NULL",
                    ).single(),
                )
                assertEquals(boss, conn.queryLongs("SELECT manager_id FROM teams_current WHERE id = $live").single())
                assertEquals(boss, conn.queryLongs("SELECT manager_id FROM teams_current WHERE id = $second").single())
                assertEquals(lead, conn.queryLongs("SELECT manager_id FROM teams_current WHERE id = $gone").single())
                assertEquals(
                    teamsBefore,
                    conn.queryLongs("SELECT count(*) FROM teams_current").single(),
                    "no team may drop out of the view",
                )
                assertEquals(1L, conn.queryLongs("SELECT count(*) FROM teams_current WHERE id = $gone AND marked_as_deleted").single())

                // Neither view is updatable: a stray DELETE/UPDATE through team_members must not reach the table.
                assertEquals(
                    listOf("NO", "NO"),
                    conn.createStatement().use { st ->
                        st.executeQuery(
                            "SELECT is_updatable FROM information_schema.views WHERE table_schema = '$schema' " +
                                "AND table_name IN ('team_members', 'teams_current') ORDER BY table_name",
                        ).use { rs -> generateSequence { if (rs.next()) rs.getString(1) else null }.toList() }
                    },
                )
                assertTrue(runCatching { conn.exec("DELETE FROM team_members") }.isFailure, "DELETE through the view must fail")
                assertTrue(
                    runCatching { conn.exec("UPDATE team_members SET user_id = user_id") }.isFailure,
                    "UPDATE through the view must fail",
                )
                assertEquals(membersBefore, conn.queryLongs("SELECT count(*) FROM team_memberships").single())

                // teams.manager_id is gone for good (and its index with it).
                assertEquals(
                    0L,
                    conn.queryLongs(
                        "SELECT count(*) FROM information_schema.columns WHERE table_schema = '$schema' " +
                            "AND table_name = 'teams' AND column_name = 'manager_id'",
                    ).single(),
                )

                // The views are dated: an ended and a not-yet-started membership are invisible, a past manager
                // period is not the current manager, and the latest qualifying start wins.
                val past = "to_char(CURRENT_DATE - 5, 'YYYY-MM-DD')"
                val yesterday = "to_char(CURRENT_DATE - 1, 'YYYY-MM-DD')"
                val tomorrow = "to_char(CURRENT_DATE + 1, 'YYYY-MM-DD')"
                conn.exec(
                    "INSERT INTO team_memberships (team_id, user_id, start_date, end_date, created_at, last_modified) VALUES " +
                        "($second, $b, $past, $yesterday, 0, 0), ($second, $c, $tomorrow, NULL, 0, 0)",
                )
                assertEquals(listOf(a), conn.queryLongs("SELECT user_id FROM team_members WHERE team_id = $second ORDER BY user_id"))
                // A successor starting tomorrow does not displace the current manager; one starting today does.
                conn.exec(
                    "INSERT INTO team_manager_periods (team_id, manager_id, start_date, end_date, created_at, last_modified) VALUES " +
                        "($second, $lead, to_char(CURRENT_DATE + 1, 'YYYY-MM-DD'), NULL, 0, 0)",
                )
                assertEquals(boss, conn.queryLongs("SELECT manager_id FROM teams_current WHERE id = $second").single())
                conn.exec(
                    "UPDATE team_manager_periods SET start_date = to_char(CURRENT_DATE, 'YYYY-MM-DD') " +
                        "WHERE team_id = $second AND manager_id = $lead",
                )
                assertEquals(lead, conn.queryLongs("SELECT manager_id FROM teams_current WHERE id = $second").single())

                // DB-level guards: end before start, and two NULL-start rows of one (team, person).
                assertTrue(
                    runCatching {
                        conn.exec(
                            "INSERT INTO team_memberships (team_id, user_id, start_date, end_date, created_at, last_modified) " +
                                "VALUES ($second, $lead, '2030-02-01', '2030-01-01', 0, 0)",
                        )
                    }.isFailure,
                    "end before start violates the CHECK",
                )
                val firstNullStart = runCatching {
                    conn.exec(
                        "INSERT INTO team_memberships (team_id, user_id, start_date, end_date, created_at, last_modified) " +
                            "VALUES ($second, $lead, NULL, '2020-01-01', 0, 0)",
                    )
                }
                assertTrue(firstNullStart.isSuccess)
                assertFalse(
                    runCatching {
                        conn.exec(
                            "INSERT INTO team_memberships (team_id, user_id, start_date, end_date, created_at, last_modified) " +
                                "VALUES ($second, $lead, NULL, '2021-01-01', 0, 0)",
                        )
                    }.isSuccess,
                    "two NULL-start rows of one (team, person) are rejected",
                )
            } finally {
                conn.exec("DROP SCHEMA IF EXISTS $schema CASCADE")
            }
        }
    }
}
