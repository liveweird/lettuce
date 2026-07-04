package ch.nokillswit

import ch.nokillswit.auth.LoginThrottle
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Unit tests for the per-account login throttle (deterministic via an injected clock). */
class LoginThrottleTest {

    private var now = 1_000_000L
    private fun throttle(threshold: Int = 3, lockoutMillis: Long = 60_000) =
        LoginThrottle(threshold, lockoutMillis) { now }

    @Test
    fun `locks after the configured number of consecutive failures`() {
        val t = throttle(threshold = 3)
        assertFalse(t.recordFailure("a@x"))
        assertFalse(t.recordFailure("a@x"))
        assertTrue(t.recordFailure("a@x"), "third failure should trip the lock")
        assertTrue(t.isLocked("a@x"))
    }

    @Test
    fun `the lock expires after the window and the counter starts fresh`() {
        val t = throttle(threshold = 2, lockoutMillis = 60_000)
        t.recordFailure("a@x")
        assertTrue(t.recordFailure("a@x"))
        assertTrue(t.isLocked("a@x"))
        now += 60_001
        assertFalse(t.isLocked("a@x"), "lock should expire")
        // The first failure after expiry does not re-lock (threshold counts from zero again).
        assertFalse(t.recordFailure("a@x"))
    }

    @Test
    fun `a successful login resets the counter`() {
        val t = throttle(threshold = 3)
        t.recordFailure("a@x")
        t.recordFailure("a@x")
        t.recordSuccess("a@x")
        assertFalse(t.recordFailure("a@x"), "counter should have been reset")
        assertFalse(t.isLocked("a@x"))
    }

    @Test
    fun `accounts are tracked independently and the email key is normalized`() {
        val t = throttle(threshold = 2)
        t.recordFailure("a@x")
        assertFalse(t.isLocked("b@x"))
        // Same account spelled differently shares the counter.
        assertTrue(t.recordFailure("  A@X  "))
        assertTrue(t.isLocked("a@x"))
    }

}
