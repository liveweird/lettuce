package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals

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

        // Two failures (threshold is 3), then the deactivated-403 path — deliberately neither
        // recordFailure (correct credentials must not feed the lockout) nor recordSuccess.
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
