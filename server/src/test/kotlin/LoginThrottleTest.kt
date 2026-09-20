package ch.nokillswit

import ch.nokillswit.auth.LoginThrottle
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Tests for the DB-backed per-account login throttle (V81, `login_lockouts` over the shared
 * Testcontainers Postgres; deterministic via an injected clock). Every test keys its own unique
 * email(s) — the table is shared, live, container-wide state.
 *
 * The route reserves an attempt ([LoginThrottle.reserveAttempt]) BEFORE password verification
 * (checkup #36 M1/v3.13.1) and only afterwards decides, from the returned failure count, whether
 * to trip the lock ([LoginThrottle.lock]) — these tests drive that same two-step shape directly.
 */
class LoginThrottleTest {

    private var now = 1_000_000L
    private fun throttle(threshold: Int = 3, lockoutMillis: Long = 60_000) =
        LoginThrottle(TestServices.database, threshold, lockoutMillis) { now }

    /** Reserves an attempt and, mirroring the route, locks once the count reaches [threshold]. */
    private suspend fun failAttempt(t: LoginThrottle, email: String, threshold: Int): LoginThrottle.Reservation {
        val reservation = t.reserveAttempt(email)
        if (!reservation.locked && reservation.failures >= threshold) {
            t.lock(email)
        }
        return reservation
    }

    @Test
    fun `locks after the configured number of consecutive failures`(): Unit = runBlocking {
        val t = throttle(threshold = 3)
        val email = uniqueEmail("throttle-lock")
        assertFalse(failAttempt(t, email, 3).locked)
        assertFalse(failAttempt(t, email, 3).locked)
        failAttempt(t, email, 3) // third failure trips the lock
        assertTrue(t.isLocked(email))
    }

    @Test
    fun `the lock expires after the window and the counter starts fresh`(): Unit = runBlocking {
        val t = throttle(threshold = 2, lockoutMillis = 60_000)
        val email = uniqueEmail("throttle-expire")
        failAttempt(t, email, 2)
        failAttempt(t, email, 2)
        assertTrue(t.isLocked(email))
        now += 60_001
        assertFalse(t.isLocked(email), "lock should expire")
        // The first failure after expiry does not re-lock (threshold counts from zero again).
        assertFalse(failAttempt(t, email, 2).locked)
    }

    @Test
    fun `a successful login resets the counter`(): Unit = runBlocking {
        val t = throttle(threshold = 3)
        val email = uniqueEmail("throttle-reset")
        failAttempt(t, email, 3)
        failAttempt(t, email, 3)
        t.recordSuccess(email)
        assertFalse(failAttempt(t, email, 3).locked, "counter should have been reset")
        assertFalse(t.isLocked(email))
    }

    @Test
    fun `accounts are tracked independently and the email key is normalized`(): Unit = runBlocking {
        val t = throttle(threshold = 2)
        val email = uniqueEmail("throttle-norm")
        val other = uniqueEmail("throttle-other")
        failAttempt(t, email, 2)
        assertFalse(t.isLocked(other))
        // Same account spelled differently shares the counter.
        assertTrue(failAttempt(t, "  ${email.uppercase()}  ", 2).let { t.isLocked(email) })
    }

    @Test
    fun `isLocked reads without a row, with a live lock, and with an expired one`(): Unit = runBlocking {
        val t = throttle(threshold = 1, lockoutMillis = 1_000)
        val fresh = uniqueEmail("throttle-fresh")
        // No row at all.
        assertFalse(t.isLocked(fresh))
        val expiring = uniqueEmail("throttle-expiring")
        failAttempt(t, expiring, 1) // threshold 1: trips immediately
        assertTrue(t.isLocked(expiring))
        now += 1_001
        assertFalse(t.isLocked(expiring), "lockedUntil is now in the past")
    }

    @Test
    fun `a stale untouched row is pruned by the next write for any key`(): Unit = runBlocking {
        val t = throttle(threshold = 1, lockoutMillis = 1_000)
        val email = uniqueEmail("throttle-prune")
        failAttempt(t, email, 1) // trips immediately
        // Past lockedUntil AND past the week-long counter retention (a full lockout window
        // alone is NOT enough — an idle sub-threshold counter must survive it).
        now += 7L * 24 * 60 * 60 * 1000 + 2_001
        // Any write — even for an unrelated key — sweeps stale rows opportunistically.
        t.reserveAttempt(uniqueEmail("throttle-prune-trigger"))
        val remaining = suspendTransaction(TestServices.database) {
            LoginThrottle.LoginLockouts.selectAll()
                .where { LoginThrottle.LoginLockouts.email eq email.trim().lowercase() }
                .toList()
        }
        assertTrue(remaining.isEmpty(), "the stale row should have been pruned")
    }

    @Test
    fun `a reservation taken while locked does not increment the counter`(): Unit = runBlocking {
        val t = throttle(threshold = 2, lockoutMillis = 60_000)
        val email = uniqueEmail("throttle-locked-no-increment")
        failAttempt(t, email, 2)
        failAttempt(t, email, 2) // trips the lock, failures reset to 0 by lock()
        assertTrue(t.isLocked(email))
        // Further reservations while locked must report locked without moving the counter.
        val whileLocked = t.reserveAttempt(email)
        assertTrue(whileLocked.locked)
        now += 60_001
        assertFalse(t.isLocked(email), "lock should have expired")
        // Had a reservation while locked bumped the counter, this first post-expiry failure
        // would already trip the lock at threshold 2.
        assertFalse(t.reserveAttempt(email).locked)
    }

    @Test
    fun `release decrements the counter but never below zero`(): Unit = runBlocking {
        val t = throttle(threshold = 5)
        val email = uniqueEmail("throttle-release")
        // No row yet: releasing is a harmless no-op.
        t.release(email)
        assertFalse(t.isLocked(email))

        assertEquals(1, t.reserveAttempt(email).failures)
        assertEquals(2, t.reserveAttempt(email).failures)
        t.release(email)
        assertEquals(2, t.reserveAttempt(email).failures, "one reservation was released, one net increment remains")

        t.release(email)
        t.release(email)
        t.release(email)
        // Never below zero: the counter should have floored at 0, not gone negative.
        assertEquals(1, t.reserveAttempt(email).failures)
    }

    @Test
    fun `a reservation exceeding the threshold locks even without an explicit lock() call`(): Unit = runBlocking {
        val t = throttle(threshold = 3, lockoutMillis = 60_000)
        val email = uniqueEmail("throttle-burst-backstop")
        // Three reservations land the counter exactly at the threshold — still allowed, as the
        // route decides whether THIS attempt trips the lock only once bcrypt confirms it wrong.
        assertFalse(t.reserveAttempt(email).locked)
        assertFalse(t.reserveAttempt(email).locked)
        assertFalse(t.reserveAttempt(email).locked)
        // A fourth CONCURRENT reservation (nobody has called lock() yet) exceeds the threshold —
        // reserveAttempt's own backstop trips the lock right here.
        val fourth = t.reserveAttempt(email)
        assertTrue(fourth.locked, "the (threshold + 1)-th concurrent reservation must self-lock")
        assertTrue(t.isLocked(email))
    }
}
