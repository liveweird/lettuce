package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
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
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Startup behavior of plugins/Security.kt: the JWT-secret fail-closed check (blank/placeholder
 * secret allowed only in development) and the `security.csrf.enabled` gate. These need config
 * overrides beyond [usePostgresTestcontainer], so they build the environment themselves.
 */
class SecurityConfigTest {

    // Mirrors usePostgresTestcontainer but allows extra overrides and defers startApplication()
    // to the test (so startup failures can be asserted). Later duplicate keys win in
    // MapApplicationConfig, so overrides may replace the defaults listed first.
    private fun ApplicationTestBuilder.configureApp(vararg overrides: Pair<String, String>) {
        environment {
            config = ApplicationConfig("application.yaml").mergeWith(
                MapApplicationConfig(
                    "postgres.jdbcUrl" to PostgresTestSupport.jdbcUrl,
                    "postgres.r2dbcUrl" to PostgresTestSupport.r2dbcUrl,
                    "postgres.user" to PostgresTestSupport.user,
                    "postgres.password" to PostgresTestSupport.password,
                    "security.csrf.enabled" to "false",
                    *overrides,
                )
            )
        }
    }

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
        configureApp("jwt.secret" to "strong-${UUID.randomUUID()}")
        serverConfig { developmentMode = false }
        // Boots (no fail-closed error) — and the production-only HttpsRedirect plugin is active,
        // so a plain-HTTP request is permanently redirected instead of served.
        startApplication()
        val client = createClient { followRedirects = false }
        val response = client.get("/api/v1/notifications")
        assertEquals(HttpStatusCode.MovedPermanently, response.status)
        assertTrue(response.headers[HttpHeaders.Location]!!.startsWith("https://"))
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
    }
}
