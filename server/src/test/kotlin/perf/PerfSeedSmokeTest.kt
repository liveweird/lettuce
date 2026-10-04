package ch.nokillswit.perf

import ch.nokillswit.PostgresTestSupport
import ch.nokillswit.feedbacks.FeedbackService
import ch.nokillswit.goals.GoalEventService
import ch.nokillswit.goals.GoalService
import ch.nokillswit.infra.crypto.DEV_DATA_ENCRYPTION_KEY
import ch.nokillswit.infra.crypto.EncryptedAtRest
import ch.nokillswit.infra.crypto.FieldCipher
import ch.nokillswit.impactlog.ImpactLogService
import ch.nokillswit.oneonones.OneOnOneService
import ch.nokillswit.pulse.PulseResponseService
import ch.nokillswit.reviews.PerformanceReviewService
import ch.nokillswit.succession.SuccessionPlanService
import ch.nokillswit.teamkpis.TeamKpiService
import ch.nokillswit.daysoff.DaysOffService
import kotlinx.coroutines.runBlocking
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import java.nio.file.Files
import java.nio.file.Path
import java.sql.DriverManager
import java.time.LocalDate
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * A throwaway database inside the shared Testcontainer: Flyway migrates it from scratch and the
 * generator seeds it, so the run can never collide with the other tests' data in `lettuce_test`
 * (the review-period timeline, the dictionaries and the seed accounts are global there).
 */
private class ScratchDatabase {
    val name = "perf_smoke_" + UUID.randomUUID().toString().replace("-", "")
    val jdbcUrl = PostgresTestSupport.jdbcUrl.replace("/lettuce_test", "/$name")
    val r2dbcUrl = PostgresTestSupport.r2dbcUrl.replace("/lettuce_test", "/$name")

    private fun admin(sql: String) = DriverManager.getConnection(
        PostgresTestSupport.jdbcUrl, PostgresTestSupport.user, PostgresTestSupport.password,
    ).use { it.createStatement().execute(sql) }

    fun create() {
        admin("CREATE DATABASE $name")
    }

    fun drop() {
        admin("DROP DATABASE IF EXISTS $name WITH (FORCE)")
    }

    /** Runs [sql] (single text column result) against the scratch database. */
    fun query(sql: String): List<String> = DriverManager.getConnection(jdbcUrl, PostgresTestSupport.user, PostgresTestSupport.password)
        .use { c ->
            c.createStatement().executeQuery(sql).use { rs -> generateSequence { if (rs.next()) rs.getString(1) else null }.toList() }
        }

    /**
     * Runs the checks of `perf/pg/verify.sql` — the post-seed assertions the perf run executes with psql — over JDBC on
     * ONE connection (its temp table `verify_checks` must outlive the script) and returns the failed ones as
     * `name (violations)`; empty = every check passed. The psql meta-commands (`\set …`) are dropped, and the script is cut
     * at its "Report + gate" marker: the gate's RAISE would abort the implicit transaction and take the temp table with it,
     * so the failed rows are read back here instead (the row counts after the gate only report). The checks themselves
     * hold at every scale, so nothing is parameterised.
     */
    fun verify(script: String): List<String> {
        val marker = "-- Report + gate."
        check(marker in script) { "perf/pg/verify.sql lost its '$marker' marker" }
        val sql = script.substringBefore(marker).lines().filterNot { it.trimStart().startsWith("\\") }.joinToString("\n")
        return DriverManager.getConnection(jdbcUrl, PostgresTestSupport.user, PostgresTestSupport.password).use { c ->
            c.createStatement().execute(sql)
            val failing = "SELECT name || ' (' || violations || ')' FROM verify_checks WHERE violations > 0 ORDER BY 1"
            c.createStatement().executeQuery(failing).use { rs -> generateSequence { if (rs.next()) rs.getString(1) else null }.toList() }
        }
    }
}

/**
 * The perf dataset generator end to end at a tiny scale (`perf/`, `.claude/docs/performance.md`), so CI
 * catches the runtime-only breaks a schema change causes in `server/src/test/kotlin/perf/`: a new NOT NULL
 * column without a default, a CHECK or FK the generated rows violate. Asserts it completes, that every
 * [Seeded] table received at least one row, that no plaintext sits in an encrypted column — the ten
 * `EncryptedAtRest` backfills find nothing to rewrite — and that [ENCRYPTED_COLUMNS] mirrors reality in both
 * directions. It also runs `perf/pg/verify.sql` over the scratch database (every check must hold) and requires rows
 * beyond the Flyway seeds in `public_holidays` and `days_off_pool_types`.
 */
class PerfSeedSmokeTest {

    private fun config(scratch: ScratchDatabase) = SeedConfig(
        r2dbcUrl = scratch.r2dbcUrl,
        jdbcUrl = scratch.jdbcUrl,
        user = PostgresTestSupport.user,
        password = PostgresTestSupport.password,
        key = DEV_DATA_ENCRYPTION_KEY,
        // 2028: the history reaches past the V41 migration's holiday years, so the generator's holiday top-up is exercised.
        anchor = LocalDate.of(2028, 3, 1),
        seed = 7,
        scale = 0.02,
        outDir = Files.createTempDirectory("perf-smoke"),
        force = false,
        allowedTargets = setOf(parseDbTarget(scratch.jdbcUrl).let { "${it.host}:${it.port}" }),
    )

    private fun backfillServices(db: R2dbcDatabase, cipher: FieldCipher): List<EncryptedAtRest> = listOf(
        FeedbackService(db, cipher), OneOnOneService(db, cipher), GoalService(db, cipher), GoalEventService(db, cipher),
        TeamKpiService(db, cipher), PerformanceReviewService(db, cipher), DaysOffService(db, cipher),
        PulseResponseService(db, cipher), ImpactLogService(db, cipher), SuccessionPlanService(db, cipher),
    )

    @Test
    fun `the generator completes at tiny scale and writes only enveloped ciphertext`() = runBlocking {
        val scratch = ScratchDatabase()
        scratch.create()
        try {
            val result = runSeed(config(scratch), log = {})
            val empty = Seeded.names.filter { result.counts.getValue(it) == 0L }
            assertTrue(empty.isEmpty(), "every seeded table must get at least one row; empty: $empty")

            // Rows beyond the Flyway seeds (V41's 2026-2027 holidays, V74's default pool kind), so these two cannot pass vacuously.
            val extraHolidays = scratch.query("SELECT count(*) FROM public_holidays WHERE holiday_date > '2027-12-31'").single().toLong()
            assertTrue(extraHolidays > 0, "the generator must add public holidays beyond the migration-seeded 2026-2027 years")
            val extraPools = scratch.query("SELECT count(*) FROM days_off_pool_types WHERE name <> 'Paid days off'").single().toLong()
            assertTrue(extraPools > 0, "the generator must add a pool kind beyond the migration-seeded default")

            // The dataset contract: every invariant of perf/pg/verify.sql holds on the generated rows.
            val failed = scratch.verify(Files.readString(Path.of("..", "perf", "pg", "verify.sql")))
            assertEquals(emptyList(), failed, "perf/pg/verify.sql checks failed")

            // Nothing to backfill: a registered column the generator wrote as plaintext would be rewritten.
            val db = R2dbcDatabase.connect(scratch.r2dbcUrl, user = PostgresTestSupport.user, password = PostgresTestSupport.password)
            val services = backfillServices(db, FieldCipher(DEV_DATA_ENCRYPTION_KEY))
            val rewritten = services.associate { it.encryptedRowLabel to it.encryptLegacyRows() }
            assertTrue(rewritten.values.all { it == 0 }, "the boot backfill must find nothing to encrypt, rewrote: $rewritten")

            // Every column holding an envelope is a registered one (a newly encrypted column on a seeded feature
            // must be added to ENCRYPTED_COLUMNS and verify.sql), and never mixed with plaintext.
            val textColumns = scratch.query(
                "SELECT table_name || '.' || column_name FROM information_schema.columns " +
                    "WHERE table_schema = 'public' AND data_type IN ('text', 'character varying') ORDER BY 1",
            )
            val envelopeColumns = textColumns.filter { tc ->
                val (table, column) = tc.split('.')
                scratch.query("SELECT count(*) FROM $table WHERE $column LIKE 'enc:v1:%'").single().toLong() > 0
            }.toSet()
            val registered = ENCRYPTED_COLUMNS.flatMap { (table, columns) -> columns.map { "$table.$it" } }.toSet()
            assertEquals(emptySet(), envelopeColumns - registered, "enveloped columns missing from ENCRYPTED_COLUMNS / verify.sql")
            val missing = registered.filter { it.substringBefore('.') in Seeded.names } - envelopeColumns
            assertEquals(emptyList(), missing.toList(), "registered encrypted columns of seeded tables the generator never filled")
            val plaintext = envelopeColumns.filter { tc ->
                val (table, column) = tc.split('.')
                scratch.query("SELECT count(*) FROM $table WHERE $column IS NOT NULL AND $column NOT LIKE 'enc:v1:%'").single().toLong() > 0
            }
            assertEquals(emptyList(), plaintext, "plaintext values inside encrypted columns")
        } finally {
            scratch.drop()
        }
    }
}
