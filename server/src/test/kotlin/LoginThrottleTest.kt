package ch.nokillswit

import ch.nokillswit.auth.LoginThrottle
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Tests for the DB-backed per-account login throttle (V81, `login_lockouts` over the shared
 * Testcontainers Postgres; deterministic via an injected clock). Every test keys its own unique
 * email(s) — the table is shared, live, container-wide state.
 */
class LoginThrottleTest {

    private var now = 1_000_000L
    private fun throttle(threshold: Int = 3, lockoutMillis: Long = 60_000) =
        LoginThrottle(TestServices.database, threshold, lockoutMillis) { now }

    @Test
    fun `locks after the configured number of consecutive failures`(): Unit = runBlocking {
        val t = throttle(threshold = 3)
        val email = uniqueEmail("throttle-lock")
        assertFalse(t.recordFailure(email))
        assertFalse(t.recordFailure(email))
        assertTrue(t.recordFailure(email), "third failure should trip the lock")
        assertTrue(t.isLocked(email))
    }

    @Test
    fun `the lock expires after the window and the counter starts fresh`(): Unit = runBlocking {
        val t = throttle(threshold = 2, lockoutMillis = 60_000)
        val email = uniqueEmail("throttle-expire")
        t.recordFailure(email)
        assertTrue(t.recordFailure(email))
        assertTrue(t.isLocked(email))
        now += 60_001
        assertFalse(t.isLocked(email), "lock should expire")
        // The first failure after expiry does not re-lock (threshold counts from zero again).
        assertFalse(t.recordFailure(email))
    }

    @Test
    fun `a successful login resets the counter`(): Unit = runBlocking {
        val t = throttle(threshold = 3)
        val email = uniqueEmail("throttle-reset")
        t.recordFailure(email)
        t.recordFailure(email)
        t.recordSuccess(email)
        assertFalse(t.recordFailure(email), "counter should have been reset")
        assertFalse(t.isLocked(email))
    }

    @Test
    fun `accounts are tracked independently and the email key is normalized`(): Unit = runBlocking {
        val t = throttle(threshold = 2)
        val email = uniqueEmail("throttle-norm")
        val other = uniqueEmail("throttle-other")
        t.recordFailure(email)
        assertFalse(t.isLocked(other))
        // Same account spelled differently shares the counter.
        assertTrue(t.recordFailure("  ${email.uppercase()}  "))
        assertTrue(t.isLocked(email))
    }

    @Test
    fun `isLocked reads without a row, with a live lock, and with an expired one`(): Unit = runBlocking {
        val t = throttle(threshold = 1, lockoutMillis = 1_000)
        val fresh = uniqueEmail("throttle-fresh")
        // No row at all.
        assertFalse(t.isLocked(fresh))
        val expiring = uniqueEmail("throttle-expiring")
        assertTrue(t.recordFailure(expiring)) // threshold 1: trips immediately
        assertTrue(t.isLocked(expiring))
        now += 1_001
        assertFalse(t.isLocked(expiring), "lockedUntil is now in the past")
    }

    @Test
    fun `a stale untouched row is pruned by the next write for any key`(): Unit = runBlocking {
        val t = throttle(threshold = 1, lockoutMillis = 1_000)
        val email = uniqueEmail("throttle-prune")
        assertTrue(t.recordFailure(email)) // trips immediately
        // Past both lockedUntil AND lastTouched + lockoutMillis.
        now += 2_001
        // Any write — even for an unrelated key — sweeps stale rows opportunistically.
        t.recordFailure(uniqueEmail("throttle-prune-trigger"))
        val remaining = suspendTransaction(TestServices.database) {
            LoginThrottle.LoginLockouts.selectAll()
                .where { LoginThrottle.LoginLockouts.email eq email.trim().lowercase() }
                .toList()
        }
        assertTrue(remaining.isEmpty(), "the stale row should have been pruned")
    }
}
