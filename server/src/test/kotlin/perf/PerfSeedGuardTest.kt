package ch.nokillswit.perf

import java.nio.file.Path
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/** The generator's target guard (`SeedTarget.kt`): it runs before Flyway or any connection, and `force` cannot skip it. */
class PerfSeedGuardTest {
    private fun config(
        jdbc: String,
        r2dbc: String = jdbc.replace("jdbc:", "r2dbc:"),
        force: Boolean = false,
        allowed: Set<String> = emptySet(),
    ) =
        SeedConfig(
            r2dbcUrl = r2dbc, jdbcUrl = jdbc, user = "u", password = "p", key = "k", anchor = LocalDate.of(2026, 10, 1),
            seed = 1, scale = 0.02, outDir = Path.of("unused"), force = force, allowedTargets = allowed,
        )

    @Test
    fun `urls parse with implicit port, no path, query string and userinfo`() {
        assertEquals(DbTarget("db.example", 5432, "lettuce"), parseDbTarget("jdbc:postgresql://db.example/lettuce"))
        assertEquals(DbTarget("localhost", 15432, ""), parseDbTarget("r2dbc:postgresql://localhost:15432"))
        val withUserinfo = "jdbc:postgresql://u:secret@127.0.0.1:15432/lettuce?sslmode=disable"
        assertEquals(DbTarget("127.0.0.1", 15432, "lettuce"), parseDbTarget(withUserinfo))
        assertEquals(DbTarget("127.0.0.1", 15432, "lettuce"), parseDbTarget("r2dbc:pool:postgresql://127.0.0.1:15432/lettuce"))
        assertFailsWith<IllegalArgumentException> { parseDbTarget("jdbc:postgresql:lettuce") }
        assertFailsWith<IllegalArgumentException> { parseDbTarget("jdbc:postgresql:///lettuce") }
        assertFailsWith<IllegalArgumentException> { parseDbTarget("jdbc:mysql://localhost/x") }
    }

    @Test
    fun `only a loopback host on the perf port or an allow-listed target passes`() {
        validateSeedTarget(config("jdbc:postgresql://127.0.0.1:15432/lettuce"))
        validateSeedTarget(config("jdbc:postgresql://localhost:15432/lettuce"))
        validateSeedTarget(config("jdbc:postgresql://box:40000/x", allowed = setOf("box:40000")))
        for (bad in listOf(
            "jdbc:postgresql://127.0.0.1:5432/lettuce", // the dev stack
            "jdbc:postgresql://127.0.0.1/lettuce", // implicit 5432
            "jdbc:postgresql://host/lettuce",
            "jdbc:postgresql://db.example.com:15432/lettuce", // right port, wrong host
            "jdbc:postgresql://127.0.0.1:16000/lettuce", // loopback, wrong port
        )) {
            assertFailsWith<IllegalArgumentException>(bad) { validateSeedTarget(config(bad)) }
            assertFailsWith<IllegalArgumentException>("$bad even with force") { validateSeedTarget(config(bad, force = true)) }
        }
        val mismatch = assertFailsWith<IllegalArgumentException> {
            validateSeedTarget(config("jdbc:postgresql://127.0.0.1:15432/lettuce", "r2dbc:postgresql://127.0.0.1:15432/other"))
        }
        assertTrue("same database" in mismatch.message.orEmpty())
    }

    @Test
    fun `the generator refuses before running Flyway or opening a connection`() = runBlocking {
        // A host that cannot resolve: had Flyway or a connection been attempted first, the failure would be a
        // connection error, not the guard's IllegalArgumentException.
        val error = assertFailsWith<IllegalArgumentException> {
            runSeed(config("jdbc:postgresql://no-such-host.invalid/lettuce"), log = {})
        }
        assertTrue("Refusing to seed" in error.message.orEmpty(), error.message)
    }
}
