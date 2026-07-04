package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.config.ApplicationConfig
import io.ktor.server.config.MapApplicationConfig
import io.ktor.server.config.mergeWith
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Per-account lockout on /login (auth/LoginThrottle.kt): N consecutive failures for one email →
 * 429 for the window, independent of other accounts; a success clears the counter.
 */
class LoginLockoutTest {

    private fun uniqueEmail(prefix: String) = "$prefix-${UUID.randomUUID()}@test"

    private fun ApplicationTestBuilder.configureApp(vararg overrides: Pair<String, String>) {
        environment {
            config = ApplicationConfig("application.yaml").mergeWith(
                MapApplicationConfig(
                    "postgres.jdbcUrl" to PostgresTestSupport.jdbcUrl,
                    "postgres.r2dbcUrl" to PostgresTestSupport.r2dbcUrl,
                    "postgres.user" to PostgresTestSupport.user,
                    "postgres.password" to PostgresTestSupport.password,
                    "security.csrf.enabled" to "false",
                    "security.lockout.threshold" to "3",
                    "security.lockout.durationSeconds" to "60",
                    *overrides,
                )
            )
        }
    }

    private suspend fun ApplicationTestBuilder.attemptLogin(email: String, password: String): HttpStatusCode =
        jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, password))
        }.status

    @Test
    fun `the account locks after the threshold and even the correct password is rejected`() = testApplication {
        configureApp()
        startApplication()
        val email = uniqueEmail("lock")
        TestUsers.seed(email = email, password = "right-password")

        repeat(3) { assertEquals(HttpStatusCode.Unauthorized, attemptLogin(email, "wrong")) }
        // Locked now: the CORRECT password is also refused, with 429 (not 401).
        assertEquals(HttpStatusCode.TooManyRequests, attemptLogin(email, "right-password"))
    }

    @Test
    fun `locking one account does not affect another`() = testApplication {
        configureApp()
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
        configureApp()
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
        configureApp()
        startApplication()
        val ghost = uniqueEmail("ghost")

        repeat(3) { assertEquals(HttpStatusCode.Unauthorized, attemptLogin(ghost, "whatever")) }
        assertEquals(HttpStatusCode.TooManyRequests, attemptLogin(ghost, "whatever"))
    }
}
