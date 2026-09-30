package ch.nokillswit

import ch.nokillswit.infra.db.R2dbcDatabaseKey
import ch.nokillswit.users.UserService
import io.ktor.client.request.get
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import java.sql.DriverManager
import java.util.UUID
import java.util.concurrent.TimeoutException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The bounded R2DBC connection pool (`infra/db/Database.kt`, `.claude/docs/persistence.md`
 * "Connection pool"): before it existed, a plain `r2dbc:postgresql://` connect opened one
 * PostgreSQL backend per `suspendTransaction` with nothing capping how many ran at once —
 * measured against the compose stack, 120 parallel requests produced dozens of concurrent
 * backends against PostgreSQL's default `max_connections = 100`.
 *
 * Each test mints a unique `postgres.pool.applicationName` so overlapping test applications
 * sharing the Testcontainer never share one `pg_stat_activity` count.
 */
class ConnectionPoolTest {

    /** A plain JDBC round trip against the shared Testcontainer — never through the pool under test. */
    private fun activeConnections(applicationName: String): Int =
        DriverManager.getConnection(PostgresTestSupport.jdbcUrl, PostgresTestSupport.user, PostgresTestSupport.password).use { conn ->
            conn.prepareStatement("SELECT count(*) FROM pg_stat_activity WHERE application_name = ?").use { stmt ->
                stmt.setString(1, applicationName)
                stmt.executeQuery().use { rs ->
                    rs.next()
                    rs.getInt(1)
                }
            }
        }

    /** A trivial query — just enough to make the transaction actually acquire a pooled connection. */
    private suspend fun org.jetbrains.exposed.v1.r2dbc.R2dbcTransaction.touchDatabase() {
        UserService.Users.selectAll().limit(1).toList()
    }

    @Test
    fun `concurrent transactions are bounded by postgres pool maxSize`() = testApplication {
        val appName = "lettuce-test-${UUID.randomUUID()}"
        configureApp("postgres.pool.maxSize" to "4", "postgres.pool.applicationName" to appName)
        startApplication()
        val db = application.attributes[R2dbcDatabaseKey]

        val gate = CompletableDeferred<Unit>()
        coroutineScope {
            repeat(12) {
                launch(Dispatchers.IO) {
                    suspendTransaction(db) {
                        touchDatabase()
                        gate.await()
                    }
                }
            }
            // Poll while (up to) four of the twelve coroutines are holding a pooled connection
            // and the rest are queued waiting to acquire one.
            var maxObserved = 0
            val deadline = System.nanoTime() + 2_000_000_000L
            while (System.nanoTime() < deadline) {
                maxObserved = maxOf(maxObserved, activeConnections(appName))
                delay(50)
            }
            assertTrue(
                maxObserved in 1..4,
                "expected at most 4 concurrent pooled connections (postgres.pool.maxSize), observed $maxObserved",
            )
            gate.complete(Unit)
            // Exiting this coroutineScope suspends until all 12 launched transactions complete —
            // a hang here means a released connection was never handed to a queued waiter.
        }
    }

    @Test
    fun `a saturated pool times out an acquire instead of hanging`() = testApplication {
        val appName = "lettuce-test-${UUID.randomUUID()}"
        configureApp(
            "postgres.pool.maxSize" to "1",
            "postgres.pool.initialSize" to "0",
            "postgres.pool.maxAcquireTimeSeconds" to "1",
            "postgres.pool.applicationName" to appName,
        )
        startApplication()
        val db = application.attributes[R2dbcDatabaseKey]

        val gate = CompletableDeferred<Unit>()
        val holderStarted = CompletableDeferred<Unit>()
        coroutineScope {
            val holder = launch(Dispatchers.IO) {
                suspendTransaction(db) {
                    touchDatabase()
                    holderStarted.complete(Unit)
                    gate.await()
                }
            }
            holderStarted.await()

            // Database.kt pins defaultMaxAttempts = 1, so the 1-second acquire deadline surfaces after
            // ONE attempt (Exposed's default of three would triple it) — a generous outer bound around
            // that observed failure, never a sleep (.claude/docs/testing.md).
            val failure = withTimeoutOrNull(20_000) {
                runCatching { suspendTransaction(db) { touchDatabase() } }.exceptionOrNull()
            }
            assertNotNull(failure, "the second transaction must fail rather than hang past maxAcquireTimeSeconds")
            val chain = generateSequence(failure) { it.cause }.toList()
            assertTrue(
                chain.any { it is TimeoutException },
                "expected the pool's acquire-timeout exception in the cause chain, got: ${chain.map { it::class.qualifiedName }}",
            )

            gate.complete(Unit)
            holder.join()
        }
    }

    @Test
    fun `the pool releases every connection when the application stops`() {
        val appName = "lettuce-test-${UUID.randomUUID()}"
        testApplication {
            configureApp("postgres.pool.applicationName" to appName)
            startApplication()
            suspendTransaction(application.attributes[R2dbcDatabaseKey]) { touchDatabase() }
            assertTrue(activeConnections(appName) >= 1, "expected at least one pooled backend while the app is running")
        }
        // The testApplication{} block above has returned, which stops the embedded application
        // (and, via our ApplicationStopped hook, disposes the pool) before control reaches here.
        runBlocking {
            val cleared = withTimeoutOrNull(5_000) {
                while (isActive && activeConnections(appName) > 0) delay(100)
                true
            }
            assertNotNull(cleared, "expected pooled connections to be released once the application stopped")
        }
    }

    @Test
    fun `the pool is released even when a later module refuses startup`() {
        // configureAuthRoutes runs AFTER configureDatabase (application.yaml module order) and
        // range-checks security.lockout.threshold in EVERY mode — so the pool has already been
        // built when startup aborts. Stopping the half-started application must still dispose it.
        val appName = "lettuce-test-${UUID.randomUUID()}"
        testApplication {
            configureApp(
                "postgres.pool.applicationName" to appName,
                "security.lockout.threshold" to "0",
            )
            assertStartupFails("security.lockout.threshold") { startApplication() }
        }
        runBlocking {
            val cleared = withTimeoutOrNull(5_000) {
                while (isActive && activeConnections(appName) > 0) delay(100)
                true
            }
            assertNotNull(cleared, "expected the pool to be disposed after a failed startup")
        }
    }

    @Test
    fun `postgres pool maxSize out of range fails startup`() = testApplication {
        configureApp("postgres.pool.maxSize" to "0")
        assertStartupFails("postgres.pool.maxSize") { startApplication() }
    }

    @Test
    fun `postgres pool initialSize above maxSize fails startup`() = testApplication {
        configureApp("postgres.pool.initialSize" to "5", "postgres.pool.maxSize" to "2")
        assertStartupFails("postgres.pool.initialSize") { startApplication() }
    }

    // checkup #37 C2: the bounds go through the shared infra/config helpers, so a non-numeric
    // value is a config error naming the key (it used to escape as a raw NumberFormatException),
    // and the Long bounds honour their upper limit too.
    @Test
    fun `a non-numeric postgres pool bound fails startup naming the key`() = testApplication {
        configureApp("postgres.pool.maxSize" to "abc")
        assertStartupFails("Config \"postgres.pool.maxSize\" must be an integer") { startApplication() }
    }

    @Test
    fun `postgres pool maxAcquireTimeSeconds above its ceiling fails startup`() = testApplication {
        configureApp("postgres.pool.maxAcquireTimeSeconds" to "601")
        assertStartupFails("postgres.pool.maxAcquireTimeSeconds") { startApplication() }
    }

    // ---- v4.7.1: bounding a hung database -------------------------------------------------

    @Test
    fun `a hung database answers readyz 503 within the pool's bounds instead of hanging`() {
        // The relay goes silent mid-life: established pooled connections stop answering and a
        // new connection's handshake never completes. Before v4.7.1 the probe waited forever
        // (ValidationDepth.LOCAL handed out the frozen connection; the driver has no read
        // timeout). Now the acquire-time validation fails after maxValidationTime and a new
        // connection after maxCreateConnectionTime, so the acquire fails within its budget.
        FreezableRelay.forTestDatabase().use { relay ->
            testApplication {
                configureApp(
                    "postgres.r2dbcUrl" to relay.relayed(PostgresTestSupport.r2dbcUrl),
                    "postgres.pool.applicationName" to "pool-hung-${UUID.randomUUID()}",
                    "postgres.pool.maxValidationTimeSeconds" to "1",
                    "postgres.pool.maxCreateConnectionTimeSeconds" to "2",
                    "postgres.pool.maxAcquireTimeSeconds" to "3",
                )
                startApplication()
                val client = jsonClient()
                assertEquals(HttpStatusCode.OK, client.get("/readyz").status, "the relay must work while thawed")

                relay.frozen = true
                val startedAt = System.nanoTime()
                val status = withTimeout(20_000) { client.get("/readyz").status }
                val elapsedMillis = (System.nanoTime() - startedAt) / 1_000_000
                assertEquals(HttpStatusCode.ServiceUnavailable, status)
                assertTrue(elapsedMillis < 10_000, "a hung database must fail the probe within the pool bounds (took $elapsedMillis ms)")
                // Thaw before the app stops, so disposing the pool does not wait on silent sockets.
                relay.frozen = false
            }
        }
    }

    @Test
    fun `a connection the server killed is replaced at acquire, not handed to a request`() = testApplication {
        // The pre-v4.7.1 accepted gap (persistence.md "Exception"): with ValidationDepth.LOCAL a
        // backend terminated server-side was handed out once and failed that request with a 500.
        val appName = "pool-killed-${UUID.randomUUID()}"
        configureApp("postgres.pool.applicationName" to appName, "postgres.pool.initialSize" to "1", "postgres.pool.maxSize" to "1")
        startApplication()
        val db = application.attributes[R2dbcDatabaseKey]
        suspendTransaction(db) { touchDatabase() }
        assertEquals(1, terminateBackends(appName), "exactly the one pooled backend is killed")

        // The next transaction acquires the dead connection's slot: validation replaces it.
        suspendTransaction(db) { touchDatabase() }
    }

    @Test
    fun `statementTimeoutSeconds cancels a statement the server runs too long`() = testApplication {
        configureApp(
            "postgres.pool.applicationName" to "pool-stmt-${UUID.randomUUID()}",
            "postgres.statementTimeoutSeconds" to "1",
        )
        startApplication()
        val db = application.attributes[R2dbcDatabaseKey]
        // The value the server actually sees — Exposed SETs statement_timeout per statement from
        // its defaultQueryTimeout, which silently overwrote any other way of setting it.
        val setting = suspendTransaction(db) { exec("SHOW statement_timeout") { row -> row.get(0, String::class.java) }?.toList() }
        assertEquals(listOf("1s"), setting)
        val failure = runCatching {
            suspendTransaction(db) { exec("SELECT pg_sleep(3)") { row -> row.get(0) }?.toList() }
        }.exceptionOrNull()
        assertNotNull(failure, "a 3 s statement must not survive a 1 s statement_timeout")
        val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
        assertTrue("statement timeout" in messages, "unexpected failure: $messages")
    }

    @Test
    fun `the hung-database bounds are range-checked at boot`() {
        for ((key, value) in listOf(
            "postgres.pool.maxValidationTimeSeconds" to "0",
            "postgres.pool.maxValidationTimeSeconds" to "61",
            "postgres.pool.maxCreateConnectionTimeSeconds" to "601",
            "postgres.connectTimeoutSeconds" to "0",
            "postgres.statementTimeoutSeconds" to "-1",
            "postgres.statementTimeoutSeconds" to "3601",
        )) {
            testApplication {
                configureApp(key to value)
                assertStartupFails(key) { startApplication() }
            }
        }
    }

    /** Terminates every backend of [applicationName] from outside the pool; returns how many. */
    private fun terminateBackends(applicationName: String): Int =
        DriverManager.getConnection(PostgresTestSupport.jdbcUrl, PostgresTestSupport.user, PostgresTestSupport.password).use { conn ->
            conn.prepareStatement(
                "SELECT count(*) FROM (SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = ?) t",
            ).use { stmt ->
                stmt.setString(1, applicationName)
                stmt.executeQuery().use { rs ->
                    rs.next()
                    rs.getInt(1)
                }
            }
        }
}
