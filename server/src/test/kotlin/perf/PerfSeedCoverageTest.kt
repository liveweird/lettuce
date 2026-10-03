package ch.nokillswit.perf

import ch.nokillswit.PostgresTestSupport
import java.nio.file.Files
import java.nio.file.Path
import java.sql.DriverManager
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Keeps the perf generator in step with the schema without anyone remembering to: every `public` table
 * after the Flyway migration is either one the generator writes ([Seeded]) or carries a written reason in
 * [NOT_SEEDED]; and `perf/pg/verify.sql` checks every encrypted column the `EncryptedAtRest` services
 * register ([ENCRYPTED_COLUMNS], held honest by `PerfSeedSmokeTest`). A new migration that adds a table
 * fails here until the table is classified.
 */
class PerfSeedCoverageTest {

    private fun publicTables(): Set<String> {
        PostgresTestSupport.ensureMigrated()
        return DriverManager.getConnection(PostgresTestSupport.jdbcUrl, PostgresTestSupport.user, PostgresTestSupport.password).use { c ->
            c.createStatement().executeQuery(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
            ).use { rs -> generateSequence { if (rs.next()) rs.getString(1) else null }.toSet() }
        }
    }

    @Test
    fun `every table is either seeded by the generator or explicitly not seeded with a reason`() {
        val tables = publicTables()
        val unclassified = tables - Seeded.names - NOT_SEEDED.keys
        assertEquals(emptySet(), unclassified, "classify the new table(s) in perf/Seeded.kt: seed them or add a NOT_SEEDED reason")
        assertEquals(emptySet(), Seeded.names.intersect(NOT_SEEDED.keys), "a table is either seeded or not seeded")
        assertEquals(emptySet(), (Seeded.names + NOT_SEEDED.keys) - tables, "stale entries naming tables that no longer exist")
        assertTrue(NOT_SEEDED.values.all { it.isNotBlank() }, "every NOT_SEEDED entry needs a reason")
    }

    private fun overlay(): String = Files.readString(Path.of("..", "perf", "docker-compose.perf.yaml"))

    @Test
    fun `the perf stack talks to nobody - mail and Teams disabled, integration off, no catchers started`() {
        val text = overlay()
        fun setting(key: String) = Regex("""(?m)^\s+$key:\s*"?([^"\s#]+)"?""").find(text)?.groupValues?.get(1)
        assertEquals("disabled", setting("MAIL_TRANSPORT"), "perf overlay must set MAIL_TRANSPORT: disabled")
        assertEquals("disabled", setting("TEAMS_TRANSPORT"), "perf overlay must set TEAMS_TRANSPORT: disabled")
        assertEquals("false", setting("INTEGRATION_ENABLED"), "perf overlay must set INTEGRATION_ENABLED: false")
        for (service in listOf("mailpit", "teams-stub")) {
            val block = text.substringAfter("\n  $service:").substringBefore("\n\n")
            assertTrue("""profiles: ["never"]""" in block, "$service must not start in the perf project")
        }
    }

    @Test
    fun `the perf overlay encrypts with the application dev key the generator uses`() {
        val key = Regex("""DATA_ENCRYPTION_KEY:\s*([0-9a-f]{64})""").find(overlay())?.groupValues?.get(1)
        assertEquals(ch.nokillswit.infra.crypto.DEV_DATA_ENCRYPTION_KEY, key, "overlay key must equal DEV_DATA_ENCRYPTION_KEY")
    }

    @Test
    fun `verify sql checks every registered encrypted column and every named column exists`() {
        val sql = Files.readString(Path.of("..", "perf", "pg", "verify.sql"))
        val block = sql.substringAfter("FOR c IN SELECT * FROM (VALUES").substringBefore(") AS t(tbl, col)")
        val pair = Regex("""\('([a-z_0-9]+)',\s*'([a-z_0-9]+)'\)""")
        val listed = pair.findAll(block).map { "${it.groupValues[1]}.${it.groupValues[2]}" }.toSet()
        val registered = ENCRYPTED_COLUMNS.flatMap { (table, columns) -> columns.map { "$table.$it" } }.toSet()
        assertEquals(emptySet(), registered - listed, "verify.sql does not check these registered encrypted columns")
        assertEquals(emptySet(), listed - registered, "verify.sql checks columns ENCRYPTED_COLUMNS does not register")

        PostgresTestSupport.ensureMigrated()
        val url = PostgresTestSupport.jdbcUrl
        val existing = DriverManager.getConnection(url, PostgresTestSupport.user, PostgresTestSupport.password).use { c ->
            c.createStatement().executeQuery(
                "SELECT table_name || '.' || column_name FROM information_schema.columns WHERE table_schema = 'public'",
            ).use { rs -> generateSequence { if (rs.next()) rs.getString(1) else null }.toSet() }
        }
        assertEquals(emptySet(), registered - existing, "ENCRYPTED_COLUMNS names columns the schema does not have")
    }
}
