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
}
