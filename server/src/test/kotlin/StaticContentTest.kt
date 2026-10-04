package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.head
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.netty.EngineMain
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import java.nio.file.Files
import java.util.UUID
import kotlin.io.path.createDirectories
import kotlin.io.path.writeText
import kotlinx.coroutines.runBlocking
import kotlin.test.*

/**
 * The v4.14.0 response-caching policy (API-CACHE-001/002): hashed files under `assets/` are
 * immutable for a year; `index.html`, the SPA fallback and the root files are `no-cache`,
 * revalidated by content-hash ETag ONLY (no `Last-Modified`, so a rollback can never pin a stale
 * shell through a date check); and every response of the dynamic surface — `/api/` and
 * `/integration/` — is `no-store`. Boots the real app with `web.staticDir` set (the production
 * shape; local dev/tests normally serve no static routes at all).
 */
class StaticContentTest {

    private val immutable = "public, max-age=31536000, immutable"
    private val indexHtml = "<!doctype html><title>lettuce</title>"
    private val farFuture = "Fri, 01 Jan 2100 00:00:00 GMT"
    private val bigJs = "console.log('" + "lettuce".repeat(400) + "');"

    /** Boots the app over a throw-away static dir (deleted recursively afterwards). */
    private fun staticApp(vararg extra: Pair<String, String>, block: suspend ApplicationTestBuilder.() -> Unit) {
        val dir = Files.createTempDirectory("lettuce-static-test")
        try {
            dir.resolve("index.html").writeText(indexHtml)
            dir.resolve("logo-light.svg").writeText("<svg xmlns=\"http://www.w3.org/2000/svg\"/>")
            dir.resolve(".env").writeText("TOP_SECRET=1")
            dir.resolve("assets").createDirectories()
            dir.resolve("assets/app-abc123.js").writeText("console.log('app');")
            dir.resolve("assets/big-123abc.js").writeText(bigJs)
            dir.resolve("assets/index-def456.css").writeText("body{margin:0}")
            testApplication {
                configureApp("web.staticDir" to dir.toString(), *extra)
                startApplication()
                block()
            }
        } finally {
            dir.toFile().deleteRecursively()
        }
    }

    private fun HttpResponse.assertSecurityHeaders() {
        assertEquals("nosniff", headers["X-Content-Type-Options"])
        assertNotNull(headers["Content-Security-Policy"], "static and 304 responses keep the strict CSP")
    }

    private suspend fun HttpClient.revalidate(path: String, etag: String, cacheControl: String) {
        val response = get(path) { header(HttpHeaders.IfNoneMatch, etag) }
        assertEquals(HttpStatusCode.NotModified, response.status, "$path with a matching If-None-Match")
        assertEquals(listOf(cacheControl), response.headers.getAll(HttpHeaders.CacheControl), "$path 304 keeps its policy")
        assertEquals("", response.bodyAsText())
        response.assertSecurityHeaders()
    }

    private fun HttpResponse.assertSingleNoStore(what: String) =
        assertEquals(listOf("no-store"), headers.getAll(HttpHeaders.CacheControl), what)

    private suspend fun ApplicationTestBuilder.adminToken(): String {
        val email = uniqueEmail("static-cache")
        TestUsers.seed(email, "pw-static-1234")
        return jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, "pw-static-1234"))
        }.body<LoginResponse>().token
    }

    @Test
    fun `hashed assets are immutable with an ETag only and revalidate to 304`() = staticApp {
        for (path in listOf("/assets/app-abc123.js", "/assets/index-def456.css")) {
            val response = client.get(path)
            assertEquals(HttpStatusCode.OK, response.status, path)
            // Exactly ONE Cache-Control header: the old CSS-only CachingHeaders rule must be gone.
            assertEquals(listOf(immutable), response.headers.getAll(HttpHeaders.CacheControl), path)
            val etag = assertNotNull(response.headers[HttpHeaders.ETag], "$path ETag")
            assertNull(response.headers[HttpHeaders.LastModified], "$path must not disclose the build time")
            response.assertSecurityHeaders()
            client.revalidate(path, etag, immutable)
        }
    }

    @Test
    fun `index html and the SPA fallback are no-cache with an ETag and revalidate to 304`() = staticApp {
        for (path in listOf("/", "/index.html", "/users/5/details")) {
            val response = client.get(path)
            assertEquals(HttpStatusCode.OK, response.status, path)
            assertEquals(indexHtml, response.bodyAsText(), path)
            assertEquals(listOf("no-cache"), response.headers.getAll(HttpHeaders.CacheControl), path)
            val etag = assertNotNull(response.headers[HttpHeaders.ETag], "$path ETag")
            assertNull(response.headers[HttpHeaders.LastModified], path)
            response.assertSecurityHeaders()
            client.revalidate(path, etag, "no-cache")
        }
    }

    @Test
    fun `root files outside assets are no-cache and a stale validator still gets the body`() = staticApp {
        val response = client.get("/logo-light.svg")
        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals(listOf("no-cache"), response.headers.getAll(HttpHeaders.CacheControl))
        assertNotNull(response.headers[HttpHeaders.ETag])
        val stale = client.get("/logo-light.svg") { header(HttpHeaders.IfNoneMatch, "\"not-the-etag\"") }
        assertEquals(HttpStatusCode.OK, stale.status)
        assertContains(stale.bodyAsText(), "<svg")
    }

    @Test
    fun `the ETag is a content hash - equal across GET and HEAD`() = staticApp {
        val first = client.get("/assets/app-abc123.js").headers[HttpHeaders.ETag]
        val second = client.head("/assets/app-abc123.js").headers[HttpHeaders.ETag]
        assertNotNull(first)
        assertEquals(first, second)
    }

    @Test
    fun `HEAD carries the same Cache-Control policy`() = staticApp {
        assertEquals(listOf(immutable), client.head("/assets/app-abc123.js").headers.getAll(HttpHeaders.CacheControl))
        assertEquals(listOf("no-cache"), client.head("/").headers.getAll(HttpHeaders.CacheControl))
    }

    @Test
    fun `If-Modified-Since never decides - a rollback with a newer date still gets the body`() = staticApp {
        for (path in listOf("/", "/assets/app-abc123.js", "/users/5/details")) {
            // The shell after a rollback: the browser holds the NEWER image's ETag and a newer date.
            val rolledBack = client.get(path) {
                header(HttpHeaders.IfNoneMatch, "\"etag-of-the-newer-image\"")
                header(HttpHeaders.IfModifiedSince, farFuture)
            }
            assertEquals(HttpStatusCode.OK, rolledBack.status, path)
            assertTrue(rolledBack.bodyAsText().isNotEmpty(), path)
            // A date alone is no validator at all.
            val dateOnly = client.get(path) { header(HttpHeaders.IfModifiedSince, farFuture) }
            assertEquals(HttpStatusCode.OK, dateOnly.status, path)
            assertNull(dateOnly.headers[HttpHeaders.LastModified], path)
        }
    }

    @Test
    fun `a malformed If-None-Match or If-Match is ignored - 200 with the body, never a 500`() = staticApp {
        for (path in listOf("/", "/assets/app-abc123.js", "/users/5/details")) {
            for (header in listOf(HttpHeaders.IfNoneMatch, HttpHeaders.IfMatch)) {
                for (malformed in listOf("\"x\";q=0.5", "a b")) {
                    val response = client.get(path) { header(header, malformed) }
                    assertEquals(HttpStatusCode.OK, response.status, "$path $header: $malformed")
                    assertTrue(response.bodyAsText().isNotEmpty(), "$path $header: $malformed")
                    assertNull(response.headers[HttpHeaders.LastModified])
                }
            }
        }
    }

    @Test
    fun `a missing hashed chunk falls back to index html and is never immutable`() = staticApp {
        val response = client.get("/assets/missing-zzz.js")
        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals(indexHtml, response.bodyAsText())
        assertEquals(listOf("no-cache"), response.headers.getAll(HttpHeaders.CacheControl))
    }

    @Test
    fun `traversal, dotfile and directory probes never expose files or a listing`() = staticApp {
        val probes = listOf("/assets/../../etc/passwd", "/%2e%2e/x", "/%2e%2e%2f%2e%2e%2fetc/passwd", "/.env", "/assets/", "/assets")
        for (path in probes) {
            val response = client.get(path)
            val body = response.bodyAsText()
            assertFalse("root:" in body, "$path leaked /etc/passwd")
            assertFalse("TOP_SECRET" in body, "$path served a dotfile")
            assertFalse("app-abc123.js" in body, "$path rendered a directory listing")
            assertTrue(
                response.status == HttpStatusCode.OK && body == indexHtml ||
                    response.status in listOf(HttpStatusCode.BadRequest, HttpStatusCode.Forbidden, HttpStatusCode.NotFound),
                "$path -> ${response.status}: $body",
            )
        }
        // The dot-segment policy is pinned exactly: 403, for an existing and a missing dotfile alike.
        for (path in listOf("/.env", "/.well-known/security.txt")) {
            assertEquals(HttpStatusCode.Forbidden, client.get(path).status, path)
        }
    }

    @Test
    fun `gzip keeps the content ETag and varies on Accept-Encoding`() = staticApp {
        val plain = client.get("/assets/big-123abc.js")
        val etag = assertNotNull(plain.headers[HttpHeaders.ETag])
        val gzip = client.get("/assets/big-123abc.js") { header(HttpHeaders.AcceptEncoding, "gzip") }
        assertEquals(HttpStatusCode.OK, gzip.status)
        assertEquals("gzip", gzip.headers[HttpHeaders.ContentEncoding])
        // Accepted: the strong ETag is shared across encodings (nothing here serves range requests).
        assertEquals(etag, gzip.headers[HttpHeaders.ETag])
        assertContains(gzip.headers[HttpHeaders.Vary].orEmpty(), "Accept-Encoding")
        assertEquals(listOf(immutable), gzip.headers.getAll(HttpHeaders.CacheControl))
    }

    @Test
    fun `without web staticDir no static route exists`() = testApplication {
        usePostgresTestcontainer()
        assertEquals(HttpStatusCode.NotFound, client.get("/assets/app-abc123.js").status)
    }

    @Test
    fun `API problem responses are no-store with the security headers`() = staticApp {
        val unauthenticated = jsonClient().get("/api/v1/users")
        assertEquals(HttpStatusCode.Unauthorized, unauthenticated.status)
        unauthenticated.assertSingleNoStore("401")
        unauthenticated.assertSecurityHeaders()
        // The SPA fallback also answers an unknown /api/ path with index.html (pre-existing: the
        // fallback is path-blind); the no-store rule must still win over the static no-cache.
        // Default client: the conformance plugin rightly flags an undeclared API path.
        client.get("/api/v1/does-not-exist").assertSingleNoStore("unknown /api path")
    }

    @Test
    fun `a 405 re-responded by StatusPages carries ONE no-store, not two`() = staticApp {
        val response = client.put("/api/v1/login")
        assertEquals(HttpStatusCode.MethodNotAllowed, response.status)
        response.assertSingleNoStore("405")
    }

    @Test
    fun `an API success response carries no-store and no validators`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("static-cache")
        TestUsers.seed(email, "pw-static-1234")
        val response = authedClient(email, "pw-static-1234").get("/api/v1/templates?pageSize=1")
        assertEquals(HttpStatusCode.OK, response.status)
        response.assertSingleNoStore("200")
        assertNull(response.headers[HttpHeaders.ETag])
        assertNull(response.headers[HttpHeaders.LastModified])
    }

    @Test
    fun `API conditional headers are inert - a read stays 200 and a write is never 412`() = staticApp {
        val token = adminToken()
        val read = client.get("/api/v1/templates?pageSize=1") {
            header(HttpHeaders.Authorization, "Bearer $token")
            header(HttpHeaders.IfNoneMatch, "*")
            header(HttpHeaders.IfModifiedSince, farFuture)
        }
        assertEquals(HttpStatusCode.OK, read.status)
        read.assertSingleNoStore("conditional read")
        val write = client.put("/api/v1/templates/999999") {
            header(HttpHeaders.Authorization, "Bearer $token")
            header(HttpHeaders.IfMatch, "\"x\"")
            contentType(ContentType.Application.Json)
            setBody("{}")
        }
        assertNotEquals(HttpStatusCode.PreconditionFailed, write.status)
        write.assertSingleNoStore("conditional write")
    }

    /**
     * `//api/...` can only be sent on a real wire (the test engine reads `//api` as an authority),
     * so this boots the real Netty engine like ProductionHttpTest. Ktor's router skips empty
     * segments, so the doubled slash reaches the same handlers — every path policy must see through it.
     */
    @Test
    fun `a doubled leading slash does not escape the API policies`() {
        val server = EngineMain.createServer(
            arrayOf(
                "-port=0",
                "-P:postgres.jdbcUrl=${PostgresTestSupport.jdbcUrl}",
                "-P:postgres.r2dbcUrl=${PostgresTestSupport.r2dbcUrl}",
                "-P:postgres.user=${PostgresTestSupport.user}",
                "-P:postgres.password=${PostgresTestSupport.password}",
                "-P:security.csrf.enabled=false",
            ),
        )
        try {
            server.start(wait = false)
            val port = runBlocking { server.engine.resolvedConnectors().first().port }
            val http = java.net.http.HttpClient.newHttpClient()
            fun get(path: String): java.net.http.HttpResponse<String> = http.send(
                java.net.http.HttpRequest.newBuilder(java.net.URI("http://127.0.0.1:$port$path")).GET().build(),
                java.net.http.HttpResponse.BodyHandlers.ofString(),
            )
            val unauthenticated = get("//api/v1/templates")
            assertEquals(401, unauthenticated.statusCode(), "the doubled slash reaches the router")
            assertEquals(listOf("no-store"), unauthenticated.headers().allValues("Cache-Control"))
            // MT-005: the negative-id intercept shares the same normalized predicate.
            val negative = get("//api/v1/users/-1")
            assertEquals(400, negative.statusCode())
            assertEquals(listOf("no-store"), negative.headers().allValues("Cache-Control"))
            assertEquals(400, get("/api/v1/users/-1").statusCode())
        } finally {
            server.stop(0, 0)
        }
    }

    @Test
    fun `the integration surface is no-store too`() = staticApp("integration.enabled" to "true") {
        val schema = client.get("/integration/graphql/schema")
        assertEquals(HttpStatusCode.Unauthorized, schema.status)
        schema.assertSingleNoStore("integration schema")
        val graphql = client.post("/integration/graphql") {
            contentType(ContentType.Application.Json)
            setBody("""{"query":"{ reviewPeriods { id } }"}""")
        }
        assertEquals(HttpStatusCode.Unauthorized, graphql.status)
        graphql.assertSingleNoStore("integration graphql")
    }

    @Test
    fun `production mode - a static 304 carries HSTS, the CSP and its cache policy`() = testApplication {
        TestSeedState.restoreSeedAccounts()
        val dir = Files.createTempDirectory("lettuce-static-prod-test")
        try {
            dir.resolve("index.html").writeText(indexHtml)
            configureApp(
                "web.staticDir" to dir.toString(),
                "bootstrap.adminInitialPassword" to "rotated-${UUID.randomUUID()}",
                "jwt.secret" to "strong-${UUID.randomUUID()}",
                "security.encryption.key" to strongEncryptionKey(),
                // The dev-default `log` mail transport is refused in production (see infra/mail).
                "mail.transport" to "disabled",
                // Marks requests already-HTTPS (the ProductionHttpTest proxy contract) instead of the redirect.
                "http.behindProxy" to "true",
            )
            serverConfig { developmentMode = false }
            startApplication()
            val secure = { builder: io.ktor.client.request.HttpRequestBuilder ->
                builder.header("X-Forwarded-Proto", "https")
            }
            val first = client.get("/") { secure(this) }
            assertEquals(HttpStatusCode.OK, first.status)
            val etag = assertNotNull(first.headers[HttpHeaders.ETag])
            val revalidated = client.get("/") {
                secure(this)
                header(HttpHeaders.IfNoneMatch, etag)
            }
            assertEquals(HttpStatusCode.NotModified, revalidated.status)
            assertNotNull(revalidated.headers["Strict-Transport-Security"], "HSTS rides the 304")
            revalidated.assertSecurityHeaders()
            assertEquals(listOf("no-cache"), revalidated.headers.getAll(HttpHeaders.CacheControl))
        } finally {
            dir.toFile().deleteRecursively()
            TestSeedState.restoreSeedAccounts()
        }
    }
}
