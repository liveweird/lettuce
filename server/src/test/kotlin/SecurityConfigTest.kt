package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.infra.config.MAX_DURATION_SECONDS
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Startup behavior of plugins/Security.kt: the JWT-secret fail-closed check (blank/placeholder
 * secret allowed only in development) and the `security.csrf.enabled` gate. These need config
 * overrides beyond [usePostgresTestcontainer], so they build the environment themselves.
 */
class SecurityConfigTest {

    @Test
    fun `a strong JWT secret is accepted and its tokens work`() = testApplication {
        val secret = "strong-${UUID.randomUUID()}"
        configureApp("jwt.secret" to secret)
        startApplication()

        val email = "strong-secret-${UUID.randomUUID()}@test"
        TestUsers.seed(email = email, password = "pw")
        val client = jsonClient()
        val login = client.post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, "pw"))
        }
        assertEquals(HttpStatusCode.OK, login.status)
        val token = login.body<LoginResponse>().token
        // The issued token verifies against the configured (non-placeholder) secret.
        val authed = client.get("/api/v1/notifications") {
            header(HttpHeaders.Authorization, "Bearer $token")
        }
        assertEquals(HttpStatusCode.OK, authed.status)
    }

    @Test
    fun `a strong JWT secret boots outside development where plain HTTP is redirected`() = testApplication {
        configureApp(
            "jwt.secret" to "strong-${UUID.randomUUID()}",
            // Production mode also fail-closes on the seeded 'changeme' accounts and the burned
            // dev encryption key — rotate the admin (and let the bootstrap purge the demo users)
            // and set a strong key so this test exercises the HTTPS-redirect concern in
            // isolation. Seed state is restored afterwards.
            "bootstrap.adminInitialPassword" to "rotated-${UUID.randomUUID()}",
            "security.encryption.key" to strongEncryptionKey(),
            // The dev-default `log` mail transport is refused in production (see infra/mail).
            "mail.transport" to "disabled",
        )
        serverConfig { developmentMode = false }
        try {
            // Boots (no fail-closed error) — and the production-only HttpsRedirect plugin is active,
            // so a plain-HTTP request is permanently redirected instead of served.
            startApplication()
            val client = createClient { followRedirects = false }
            val response = client.get("/api/v1/notifications")
            assertEquals(HttpStatusCode.MovedPermanently, response.status)
            assertTrue(response.headers[HttpHeaders.Location]!!.startsWith("https://"))
        } finally {
            TestSeedState.restoreSeedAccounts()
        }
    }

    @Test
    fun `the repo-committed demo JWT secret refuses to start outside development`() = testApplication {
        // The docker-compose demo key is public (committed), so production mode must reject it
        // exactly like the "secret" placeholder.
        configureApp("jwt.secret" to "dev-only-9f3c1a7b2e8d4655b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d")
        serverConfig { developmentMode = false }

        val failure = runCatching { startApplication() }.exceptionOrNull()
        assertNotNull(failure, "startup must fail closed on the burned committed secret")
        val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
        assertTrue("JWT secret" in messages, "unexpected startup failure: $messages")
    }

    @Test
    fun `CORS is off by default - no cross-origin response headers are emitted`() = testApplication {
        configureApp()
        startApplication()

        val response = jsonClient().get("/api/v1/notifications") {
            header(HttpHeaders.Origin, "https://evil.example")
        }
        // Without the CORS plugin the request is handled normally (401 here — no token) and no
        // Access-Control-Allow-Origin is present, so browsers refuse cross-origin reads.
        assertEquals(HttpStatusCode.Unauthorized, response.status)
        assertEquals(null, response.headers[HttpHeaders.AccessControlAllowOrigin])
    }

    @Test
    fun `swagger is served in development by default and can be disabled`() = testApplication {
        configureApp()
        startApplication()
        val served = jsonClient().get("/openapi")
        assertEquals(HttpStatusCode.OK, served.status)
    }

    @Test
    fun `swagger is hidden when exposeOpenApi is false`() = testApplication {
        configureApp("http.exposeOpenApi" to "false")
        startApplication()
        val hidden = jsonClient().get("/openapi")
        assertEquals(HttpStatusCode.NotFound, hidden.status)
    }

    @Test
    fun `an explicit CORS allow-list admits only the listed host`() = testApplication {
        configureApp("http.corsHosts" to "app.example.com")
        startApplication()
        val client = jsonClient()

        val allowed = client.get("/api/v1/notifications") {
            header(HttpHeaders.Origin, "https://app.example.com")
        }
        assertEquals("https://app.example.com", allowed.headers[HttpHeaders.AccessControlAllowOrigin])

        // The CORS plugin rejects a disallowed origin with a bare 403 before the route runs —
        // an infrastructure-level response outside the OpenAPI contract, so this one request
        // deliberately uses an unvalidated client (no OpenApiConformance).
        val denied = createClient { }.get("/api/v1/notifications") {
            header(HttpHeaders.Origin, "https://evil.example")
        }
        assertEquals(null, denied.headers[HttpHeaders.AccessControlAllowOrigin])
    }

    @Test
    fun `a blank JWT secret is tolerated in development`() = testApplication {
        configureApp("jwt.secret" to "")
        // developmentMode defaults to true under testApplication → warn-and-continue.
        startApplication()
        // The app is up and serving: an unauthenticated call is a clean 401, not a dead server.
        val response = jsonClient().get("/api/v1/notifications")
        assertEquals(HttpStatusCode.Unauthorized, response.status)
    }

    @Test
    fun `the placeholder JWT secret refuses to start outside development`() = testApplication {
        configureApp() // keeps the application.yaml default secret ("secret")
        serverConfig { developmentMode = false }

        val failure = runCatching { startApplication() }.exceptionOrNull()
        assertNotNull(failure, "startup must fail closed on the placeholder secret")
        val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
        assertTrue("JWT secret" in messages, "unexpected startup failure: $messages")
    }

    @Test
    fun `a zero login lockout threshold refuses to start in every mode`() = testApplication {
        // threshold=0 would lock out the very first attempt (checkup #36, C5) — a config error,
        // not a runtime concern, so this must fail closed even in development.
        configureApp("security.lockout.threshold" to "0")

        val failure = runCatching { startApplication() }.exceptionOrNull()
        assertNotNull(failure, "startup must fail closed on a zero lockout threshold")
        val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
        assertTrue("security.lockout.threshold" in messages, "unexpected startup failure: $messages")
    }

    @Test
    fun `a zero login lockout duration refuses to start in every mode`() = testApplication {
        // durationSeconds=0 would never actually lock while login.lockout still audits a trip.
        configureApp("security.lockout.durationSeconds" to "0")

        val failure = runCatching { startApplication() }.exceptionOrNull()
        assertNotNull(failure, "startup must fail closed on a zero lockout duration")
        val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
        assertTrue("security.lockout.durationSeconds" in messages, "unexpected startup failure: $messages")
    }

    @Test
    fun `a non-numeric lockout threshold refuses to start with a clear message`() = testApplication {
        configureApp("security.lockout.threshold" to "not-a-number")

        val failure = runCatching { startApplication() }.exceptionOrNull()
        assertNotNull(failure, "startup must fail closed on a non-numeric config value")
        val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
        assertTrue("security.lockout.threshold" in messages, "unexpected startup failure: $messages")
    }

    @Test
    fun `a zero password-reset interval refuses to start in every mode`() = testApplication {
        configureApp("security.passwordReset.minIntervalSeconds" to "0")

        val failure = runCatching { startApplication() }.exceptionOrNull()
        assertNotNull(failure, "startup must fail closed on a zero password-reset interval")
        val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
        assertTrue("security.passwordReset.minIntervalSeconds" in messages, "unexpected startup failure: $messages")
    }

    @Test
    fun `a zero MFA code TTL refuses to start in every mode`() = testApplication {
        configureApp("security.mfa.codeTtlSeconds" to "0")

        val failure = runCatching { startApplication() }.exceptionOrNull()
        assertNotNull(failure, "startup must fail closed on a zero MFA code TTL")
        val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
        assertTrue("security.mfa.codeTtlSeconds" in messages, "unexpected startup failure: $messages")
    }

    @Test
    fun `an out-of-range MFA attempt cap refuses to start in every mode`() = testApplication {
        // Below the floor.
        configureApp("security.mfa.maxAttempts" to "0")
        val failure = runCatching { startApplication() }.exceptionOrNull()
        assertNotNull(failure, "startup must fail closed on a zero MFA attempt cap")
        val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
        assertTrue("security.mfa.maxAttempts" in messages, "unexpected startup failure: $messages")
    }

    @Test
    fun `an MFA attempt cap above the ceiling refuses to start in every mode`() = testApplication {
        configureApp("security.mfa.maxAttempts" to "101")
        val failure = runCatching { startApplication() }.exceptionOrNull()
        assertNotNull(failure, "startup must fail closed on an MFA attempt cap above 100")
        val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
        assertTrue("security.mfa.maxAttempts" in messages, "unexpected startup failure: $messages")
    }

    @Test
    fun `a zero MFA max-pending-challenges cap refuses to start in every mode`() = testApplication {
        // Checkup #36 Tier D — the same C5 range-check shape as the attempt cap above.
        configureApp("security.mfa.maxPendingChallenges" to "0")
        val failure = runCatching { startApplication() }.exceptionOrNull()
        assertNotNull(failure, "startup must fail closed on a zero MFA max-pending-challenges cap")
        val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
        assertTrue("security.mfa.maxPendingChallenges" in messages, "unexpected startup failure: $messages")
    }

    @Test
    fun `an MFA max-pending-challenges cap above the ceiling refuses to start in every mode`() = testApplication {
        configureApp("security.mfa.maxPendingChallenges" to "101")
        val failure = runCatching { startApplication() }.exceptionOrNull()
        assertNotNull(failure, "startup must fail closed on an MFA max-pending-challenges cap above 100")
        val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
        assertTrue("security.mfa.maxPendingChallenges" in messages, "unexpected startup failure: $messages")
    }

    @Test
    fun `a seconds window above 30 days - or one that would overflow into milliseconds - refuses to start`() {
        // An unbounded value near Long.MAX_VALUE multiplied by 1000 wraps negative and silently
        // disables the window (v4.5.2). One day past the cap, and the overflow value itself.
        val keys = listOf(
            "security.lockout.durationSeconds",
            "security.passwordReset.minIntervalSeconds",
            "security.mfa.codeTtlSeconds",
        )
        for (key in keys) {
            for (value in listOf((MAX_DURATION_SECONDS + 1).toString(), "9223372036854775")) {
                testApplication {
                    configureApp(key to value)
                    val failure = runCatching { startApplication() }.exceptionOrNull()
                    assertNotNull(failure, "startup must fail closed on $key=$value")
                    val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
                    assertTrue(key in messages, "unexpected startup failure for $key=$value: $messages")
                }
            }
        }
    }

    @Test
    fun `every other numeric knob refuses to boot out of range`() {
        // The v4.5.2 sweep of the remaining bare parses. A negative retention put the purge cutoff
        // in the future (every seen notification hard-deleted); a 0 rate limit answered 429 to
        // everyone; an overflowing TTL made tokens effectively never expire.
        val cases = listOf(
            "jwt.accessExpiresInSeconds" to "0",
            "jwt.accessExpiresInSeconds" to "86401",
            "jwt.refreshExpiresInSeconds" to (MAX_DURATION_SECONDS + 1).toString(),
            "jwt.refreshExpiresInSeconds" to "9223372036854775807",
            "notifications.retentionDays" to "-1",
            "notifications.retentionDays" to "3651",
            "notifications.retentionDays" to "thirty",
            "notifications.purgeIntervalSeconds" to "-1",
            "activity.accountRetentionDays" to "-1",
            "activity.accountRetentionDays" to "3651",
            "activity.accountRetentionDays" to "ninety",
            "activity.accountPurgeIntervalSeconds" to "-1",
            "activity.accountPurgeIntervalSeconds" to "86401",
            "feedbacks.expirySweepIntervalSeconds" to "86401",
            "security.rateLimit.loginPerMinute" to "0",
            "integration.rateLimitPerMinute" to "-5",
            "sharing.rateLimitPerMinute" to "0",
            "sharing.batchRateLimitPerMinute" to "0",
            "sharing.batchRateLimitPerMinute" to "100001",
            "sharing.batchRateLimitPerMinute" to "many",
        )
        for ((key, value) in cases) {
            testApplication {
                configureApp(key to value)
                val failure = runCatching { startApplication() }.exceptionOrNull()
                assertNotNull(failure, "startup must fail closed on $key=$value")
                val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
                assertTrue(key in messages, "unexpected startup failure for $key=$value: $messages")
            }
        }
    }

    @Test
    fun `the edges of the swept knobs boot`() = testApplication {
        configureApp(
            "jwt.accessExpiresInSeconds" to "86400",
            "jwt.refreshExpiresInSeconds" to MAX_DURATION_SECONDS.toString(),
            // 0 disables the purge; 0 intervals run on every call (the suite's own setting).
            "notifications.retentionDays" to "0",
            "notifications.purgeIntervalSeconds" to "0",
            // The sign-in history: 0 keeps it forever, 0 interval purges on every write, 3650 is the top edge.
            "activity.accountRetentionDays" to "0",
            "activity.accountPurgeIntervalSeconds" to "0",
            "feedbacks.expirySweepIntervalSeconds" to "0",
            "security.rateLimit.loginPerMinute" to "100000",
            "integration.rateLimitPerMinute" to "1",
            "sharing.rateLimitPerMinute" to "100000",
            "sharing.batchRateLimitPerMinute" to "100000",
        )
        startApplication()
        assertEquals(HttpStatusCode.Unauthorized, jsonClient().get("/api/v1/notifications").status)
    }

    @Test
    fun `the 30-day ceiling itself boots for every seconds window`() = testApplication {
        configureApp(
            "security.lockout.durationSeconds" to MAX_DURATION_SECONDS.toString(),
            "security.passwordReset.minIntervalSeconds" to MAX_DURATION_SECONDS.toString(),
            "security.mfa.codeTtlSeconds" to MAX_DURATION_SECONDS.toString(),
        )
        startApplication()
        assertEquals(HttpStatusCode.Unauthorized, jsonClient().get("/api/v1/notifications").status)
    }

    @Test
    fun `boundary values for the lockout, MFA and password-reset config boot cleanly`() = testApplication {
        // The inclusive minimums (and the MFA cap's ceiling) are accepted, not rejected.
        configureApp(
            "security.lockout.threshold" to "1",
            "security.lockout.durationSeconds" to "1",
            "security.mfa.codeTtlSeconds" to "1",
            "security.mfa.maxAttempts" to "100",
            "security.mfa.maxPendingChallenges" to "100",
            "security.passwordReset.minIntervalSeconds" to "1",
        )
        startApplication()
        val response = jsonClient().get("/api/v1/notifications")
        assertEquals(HttpStatusCode.Unauthorized, response.status)
    }

    @Test
    fun `the MFA caps boot at their floor of one`() = testApplication {
        // The sibling boundary test above pins the CEILING (100) for both MFA caps; the floor
        // is the operator setting that actually tightens security (one guess per challenge,
        // one live challenge per account), so a range check that rejected it would fail closed
        // against the strictest configuration.
        configureApp(
            "security.mfa.maxAttempts" to "1",
            "security.mfa.maxPendingChallenges" to "1",
        )
        startApplication()
        val response = jsonClient().get("/api/v1/notifications")
        assertEquals(HttpStatusCode.Unauthorized, response.status)
    }

    @Test
    fun `enabling CSRF blocks unsafe requests without an origin`() = testApplication {
        configureApp("security.csrf.enabled" to "true")
        startApplication()

        // The Ktor test client sends no Origin header and no X-CSRF-Token, so with the plugin
        // installed every unsafe (POST) request is rejected before reaching the route.
        val response = jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest("admin@lettuce.local", "changeme"))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
        // The rejection keeps the house rule: every error body is RFC 7807 problem+json.
        assertTrue(response.headers[HttpHeaders.ContentType]?.startsWith("application/problem+json") == true)
    }
}
