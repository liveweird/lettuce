package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.plugins.ProblemDetail
import io.ktor.client.call.body
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Every 429 carries an RFC 7807 body: the per-IP RateLimit plugin's bodiless rejection is
 * completed by the StatusPages `status(TooManyRequests)` handler (plugins/ErrorHandling.kt),
 * while the per-account lockout's own, more specific problem body passes through untouched.
 */
class RateLimitResponseTest {

    @Test
    fun `the per-IP rate limit answers 429 with a problem+json body`() = testApplication {
        usePostgresTestcontainer()
        val client = jsonClient()

        // Exhaust the login bucket (10/60s per client host). Every attempt uses a DISTINCT
        // unknown email so the per-account lockout (threshold 5 per email) never trips —
        // the 11th request is rejected by the RateLimit plugin itself.
        repeat(10) {
            val res = client.post("/api/v1/login") {
                contentType(ContentType.Application.Json)
                setBody(LoginRequest(uniqueEmail("ratelimit"), "wrong"))
            }
            assertEquals(HttpStatusCode.Unauthorized, res.status)
        }
        val limited = client.post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(uniqueEmail("ratelimit"), "wrong"))
        }
        assertEquals(HttpStatusCode.TooManyRequests, limited.status)
        assertEquals("application/problem+json", limited.contentType()?.withoutParameters()?.toString())
        val problem = limited.body<ProblemDetail>()
        assertEquals(429, problem.status)
        assertTrue(problem.detail!!.contains("Rate limit exceeded"))
    }

    @Test
    fun `the account lockout keeps its specific problem body`() = testApplication {
        configureApp(
            "security.lockout.threshold" to "3",
            "security.lockout.durationSeconds" to "60",
        )
        startApplication()
        val client = jsonClient()
        val email = uniqueEmail("lockbody")

        repeat(3) {
            client.post("/api/v1/login") {
                contentType(ContentType.Application.Json)
                setBody(LoginRequest(email, "wrong"))
            }
        }
        val locked = client.post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, "wrong"))
        }
        // The lockout's TextContent survives the StatusPages 429 status handler (it only
        // completes status-only responses) — the account-specific detail must remain.
        assertEquals(HttpStatusCode.TooManyRequests, locked.status)
        assertEquals("application/problem+json", locked.contentType()?.withoutParameters()?.toString())
        val problem = locked.body<ProblemDetail>()
        assertTrue(problem.detail!!.contains("Too many failed login attempts"))
    }
}
