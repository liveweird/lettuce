package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Per-account lockout on /login (auth/LoginThrottle.kt): N consecutive failures for one email →
 * 429 for the window, independent of other accounts; a success clears the counter.
 */
class LoginLockoutTest {


    // The shared configureApp with a tight lockout (3 attempts, 60s) so tests trip it quickly.
    private fun ApplicationTestBuilder.configureLockoutApp() = configureApp(
        "security.lockout.threshold" to "3",
        "security.lockout.durationSeconds" to "60",
    )

    private suspend fun ApplicationTestBuilder.attemptLogin(email: String, password: String): HttpStatusCode =
        jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, password))
        }.status

    @Test
    fun `the account locks after the threshold and even the correct password is rejected`() = testApplication {
        configureLockoutApp()
        startApplication()
        val email = uniqueEmail("lock")
        TestUsers.seed(email = email, password = "right-password")

        repeat(3) { assertEquals(HttpStatusCode.Unauthorized, attemptLogin(email, "wrong")) }
        // Locked now: the CORRECT password is also refused, with 429 (not 401).
        assertEquals(HttpStatusCode.TooManyRequests, attemptLogin(email, "right-password"))
    }

    @Test
    fun `an email longer than any account can hold is a 400 that never reaches the lockout`() = testApplication {
        // checkup #37 C1: `login_lockouts.email` is VARCHAR(254), so reserving an attempt for a
        // longer email used to 500. Past the threshold (3) it must still be 400, never 429 — the
        // oversized email never took a reservation. At exactly 254 it is an ordinary 401.
        configureLockoutApp()
        startApplication()
        // Keyed on uniqueEmail (the shared-container rule in testing.md) and padded to exactly 254.
        val seed = uniqueEmail("long")
        val atLimit = "a".repeat(254 - seed.length) + seed
        val overLimit = "a$atLimit"
        repeat(4) { assertEquals(HttpStatusCode.BadRequest, attemptLogin(overLimit, "wrong")) }
        assertEquals(HttpStatusCode.Unauthorized, attemptLogin(atLimit, "wrong"))
    }

    @Test
    fun `locking one account does not affect another`() = testApplication {
        configureLockoutApp()
        startApplication()
        val locked = uniqueEmail("locked")
        val open = uniqueEmail("open")
        TestUsers.seed(email = locked, password = "pw-123456789")
        TestUsers.seed(email = open, password = "pw-123456789")

        repeat(3) { attemptLogin(locked, "wrong") }
        assertEquals(HttpStatusCode.TooManyRequests, attemptLogin(locked, "pw-123456789"))
        assertEquals(HttpStatusCode.OK, attemptLogin(open, "pw-123456789"))
    }

    @Test
    fun `a successful login resets the failure counter`() = testApplication {
        configureLockoutApp()
        startApplication()
        val email = uniqueEmail("reset")
        TestUsers.seed(email = email, password = "pw-123456789")

        repeat(2) { attemptLogin(email, "wrong") }
        assertEquals(HttpStatusCode.OK, attemptLogin(email, "pw-123456789"))
        // Two more failures after the success stay below the threshold of 3.
        repeat(2) { assertEquals(HttpStatusCode.Unauthorized, attemptLogin(email, "wrong")) }
        assertEquals(HttpStatusCode.OK, attemptLogin(email, "pw-123456789"))
    }

    @Test
    fun `a nonexistent account locks the same way - no enumeration signal`() = testApplication {
        configureLockoutApp()
        startApplication()
        val ghost = uniqueEmail("ghost")

        repeat(3) { assertEquals(HttpStatusCode.Unauthorized, attemptLogin(ghost, "whatever")) }
        assertEquals(HttpStatusCode.TooManyRequests, attemptLogin(ghost, "whatever"))
    }

    @Test
    fun `a correct-password attempt on a deactivated account does not move the lockout counter`() = testApplication {
        configureLockoutApp()
        startApplication()
        val email = uniqueEmail("deact-counter")
        val userId = TestUsers.seed(email = email, password = "pw-123456789")

        // Two failures (threshold is 3), then the deactivated-403 path. The reservation taken
        // BEFORE bcrypt bumps the counter to 3, but the 403 branch releases it back down to 2
        // (neither locking nor resetting) — deliberately net-zero, not a `recordSuccess`.
        // Don't "fix" this: counting the 403 as a failure would let an attacker with the right
        // password lock the account's eventual reactivation window.
        repeat(2) { assertEquals(HttpStatusCode.Unauthorized, attemptLogin(email, "wrong")) }
        TestServices.users.setDeactivated(userId, true)
        assertEquals(HttpStatusCode.Forbidden, attemptLogin(email, "pw-123456789"))

        // If the 403 had counted as the 3rd failure, the account would now be locked (429);
        // after reactivation the correct password must go straight through.
        TestServices.users.setDeactivated(userId, false)
        assertEquals(HttpStatusCode.OK, attemptLogin(email, "pw-123456789"))
    }

    @Test
    fun `a concurrent burst of wrong-password attempts for one account is bounded by the threshold`() =
        testApplication {
            // configureLockoutApp does not touch the per-IP login bucket, so it stays at the
            // development-mode default (1000/min) — well above the 8 requests this test sends.
            configureLockoutApp()
            startApplication()
            val email = uniqueEmail("burst")
            TestUsers.seed(email = email, password = "right-password")
            val appender = LogCapture("ch.nokillswit.audit")
            try {
                // Gate every coroutine on one CompletableDeferred so all 8 requests fire together
                // rather than trickling in one at a time (checkup #36 M1's real-concurrency pin:
                // the atomic reservation must bound the burst even when every attempt reaches the
                // server before any of them finishes its own ~100ms bcrypt verification).
                val gate = CompletableDeferred<Unit>()
                val attemptCount = 3 + 5 // threshold (3, from configureLockoutApp) + 5
                val statuses = coroutineScope {
                    val jobs = List(attemptCount) {
                        async(Dispatchers.IO) {
                            gate.await()
                            attemptLogin(email, "wrong")
                        }
                    }
                    gate.complete(Unit)
                    jobs.awaitAll()
                }

                statuses.forEach {
                    assertTrue(
                        it == HttpStatusCode.Unauthorized || it == HttpStatusCode.TooManyRequests,
                        "unexpected status $it",
                    )
                }
                val unauthorizedCount = statuses.count { it == HttpStatusCode.Unauthorized }
                assertTrue(
                    unauthorizedCount <= 3,
                    "expected at most the threshold (3) of 401s from a concurrent burst, got $unauthorizedCount",
                )

                fun eventsFor(name: String) = appender.events.count {
                    it.message == name && it.keyValuePairs.any { kv -> kv.key == "email" && kv.value == email }
                }
                val failureEvents = eventsFor("login.failure")
                val rejectedEvents = eventsFor("login.rejected_locked")
                assertTrue(
                    failureEvents <= 3,
                    "expected at most the threshold (3) of login.failure events, got $failureEvents",
                )
                assertTrue(
                    rejectedEvents >= 5,
                    "expected at least 5 login.rejected_locked events, got $rejectedEvents",
                )
                // Exactly ONE lockout record per trip, whichever path turned the lock on: the
                // backstop reservation reports `tripped`, and the route's `lock()` is a no-op
                // (false) once the row is already locked.
                assertEquals(1, eventsFor("login.lockout"), "expected exactly one login.lockout event")
            } finally {
                appender.detach()
            }
        }

    @Test
    fun `a locked deactivated account answers 429 before 403`() = testApplication {
        configureLockoutApp()
        startApplication()
        val email = uniqueEmail("deact-locked")
        val userId = TestUsers.seed(email = email, password = "pw-123456789")

        repeat(3) { assertEquals(HttpStatusCode.Unauthorized, attemptLogin(email, "wrong")) }
        TestServices.users.setDeactivated(userId, true)
        // The lockout check runs first — a locked account reveals nothing new about its state.
        assertEquals(HttpStatusCode.TooManyRequests, attemptLogin(email, "pw-123456789"))
    }
}
