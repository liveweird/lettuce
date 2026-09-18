package ch.nokillswit

import ch.nokillswit.auth.PasswordResetThrottle
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Tests for the DB-backed per-email password-reset throttle (V81, `password_reset_requests`
 * over the shared Testcontainers Postgres; deterministic via an injected clock). Every test
 * keys its own unique email(s) — the table is shared, live, container-wide state.
 */
class PasswordResetThrottleTest {

    private var now = 1_000_000L
    private fun throttle(minIntervalMillis: Long = 60_000) =
        PasswordResetThrottle(TestServices.database, minIntervalMillis) { now }

    @Test
    fun `the first request acquires, an immediate second one does not`(): Unit = runBlocking {
        val t = throttle()
        val email = uniqueEmail("reset-first")
        assertTrue(t.tryAcquire(email))
        assertFalse(t.tryAcquire(email))
    }

    @Test
    fun `the slot frees up after the interval`(): Unit = runBlocking {
        val t = throttle(minIntervalMillis = 60_000)
        val email = uniqueEmail("reset-free")
        assertTrue(t.tryAcquire(email))
        now += 59_999
        assertFalse(t.tryAcquire(email), "still inside the interval")
        now += 1
        assertTrue(t.tryAcquire(email), "interval elapsed")
    }

    @Test
    fun `a rejected attempt does not extend the wait`(): Unit = runBlocking {
        val t = throttle(minIntervalMillis = 60_000)
        val email = uniqueEmail("reset-reject")
        assertTrue(t.tryAcquire(email))
        now += 30_000
        assertFalse(t.tryAcquire(email))
        now += 30_000 // 60s after the ORIGINAL acquire, not the rejected retry
        assertTrue(t.tryAcquire(email))
    }

    @Test
    fun `emails are tracked independently and the key is normalized`(): Unit = runBlocking {
        val t = throttle()
        val email = uniqueEmail("reset-norm")
        val other = uniqueEmail("reset-other")
        assertTrue(t.tryAcquire(email))
        assertTrue(t.tryAcquire(other), "different email is unaffected")
        assertFalse(t.tryAcquire("  ${email.uppercase()}  "), "same email spelled differently shares the slot")
    }

    @Test
    fun `a stale row outside the interval is pruned by the next write for any key`(): Unit = runBlocking {
        val t = throttle(minIntervalMillis = 1_000)
        val email = uniqueEmail("reset-prune")
        assertTrue(t.tryAcquire(email))
        now += 1_001
        // Any write — even for an unrelated key — sweeps stale rows opportunistically.
        t.tryAcquire(uniqueEmail("reset-prune-trigger"))
        val remaining = suspendTransaction(TestServices.database) {
            PasswordResetThrottle.PasswordResetRequests.selectAll()
                .where { PasswordResetThrottle.PasswordResetRequests.email eq email.trim().lowercase() }
                .toList()
        }
        assertTrue(remaining.isEmpty(), "the stale row should have been pruned")
    }
}
