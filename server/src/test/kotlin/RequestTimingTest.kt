package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.infra.db.RequestDbMetrics
import ch.nokillswit.infra.db.RequestDbMetricsInterceptor
import ch.nokillswit.infra.db.SEED_ADMIN_EMAIL
import ch.nokillswit.users.UserService
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.DefaultRequest
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.statements.StatementType
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.statements.GlobalSuspendStatementInterceptor
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import java.util.ServiceLoader
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Per-request DB metrics (`plugins/RequestTiming.kt`, `core`'s `RequestDbMetrics`, the Exposed interceptor):
 * the `Server-Timing` header (on in development, off in production, `perf.serverTiming` override — and NEVER
 * on an anonymous response: the statement counts are an account-enumeration side channel), the always-on
 * slow-request log line (route path, no query string), and the interceptor's statement-window semantics.
 * The dev-mode header test rides `jsonClient()`, so the OpenAPI conformance plugin proves the undeclared
 * header is tolerated.
 */
class RequestTimingTest {

    private val headerShape = Regex("""db;dur=(\d+\.\d);desc="stmt=(\d+) tx=(\d+)", app;dur=(\d+\.\d)""")
    private val password = "pw-timing-1234"

    private fun statements(header: String?): Int =
        assertNotNull(headerShape.matchEntire(assertNotNull(header, "no Server-Timing header")), "shape: $header").groupValues[2].toInt()

    private suspend fun ApplicationTestBuilder.adminReadsAnotherUser(): HttpResponse {
        val adminEmail = uniqueEmail("timing-admin")
        TestUsers.seed(adminEmail, password, name = "Timing Admin")
        val targetId = TestUsers.seed(uniqueEmail("timing-target"), password, name = "Timing Target")
        return authedClient(adminEmail, password).get("/api/v1/users/$targetId")
    }

    @Test
    fun `development mode sends Server-Timing to an authenticated caller with statement and transaction counts`() = testApplication {
        configureApp()
        startApplication()

        val response = adminReadsAnotherUser()
        assertEquals(HttpStatusCode.OK, response.status)
        val header = assertNotNull(response.headers["Server-Timing"], "dev mode must send Server-Timing")
        val match = assertNotNull(headerShape.matchEntire(header), "unexpected Server-Timing shape: $header")
        val (statements, transactions) = match.groupValues.drop(2).take(2).map { it.toInt() }
        assertTrue(statements >= 1, "the user read (and the blocklist check) run statements: $header")
        assertTrue(transactions >= 1, "…inside transactions: $header")
    }

    @Test
    fun `the header can be switched off in development`() = testApplication {
        configureApp("perf.serverTiming" to "false")
        startApplication()

        val response = adminReadsAnotherUser()
        assertEquals(HttpStatusCode.OK, response.status)
        assertNull(response.headers["Server-Timing"])
    }

    @Test
    fun `no anonymous response carries the header - login unknown and known email, the 401 challenge, health`() = testApplication {
        configureApp() // development: the header is ON for authenticated callers
        startApplication()
        val knownEmail = uniqueEmail("timing-known")
        TestUsers.seed(knownEmail, password, name = "Timing Known")
        val client = jsonClient()
        suspend fun login(email: String) = client.post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, password))
        }

        val known = login(knownEmail)
        assertEquals(HttpStatusCode.OK, known.status)
        assertNull(known.headers["Server-Timing"], "a known email must not be distinguishable by statement count")
        val unknown = login(uniqueEmail("timing-unknown"))
        assertEquals(HttpStatusCode.Unauthorized, unknown.status)
        assertNull(unknown.headers["Server-Timing"], "an unknown email must not be distinguishable by statement count")

        val challenge = client.get("/api/v1/users/1")
        assertEquals(HttpStatusCode.Unauthorized, challenge.status)
        assertNull(challenge.headers["Server-Timing"], "the JWT challenge 401 must carry no timing")
        assertNull(createClient { }.get("/healthz").headers["Server-Timing"])
    }

    @Test
    fun `no operation declared security-none answers with the header - a spec-driven sweep`() = testApplication {
        configureApp()
        startApplication()
        val client = createClient { } // unvalidated: a bare `{}` body provokes 400/415s the conformance plugin would flag
        val leaks = mutableListOf<String>()
        var swept = 0
        for ((rawPath, item) in OpenApiSpec.parsed.paths) {
            val ops = mapOf(
                HttpMethod.Get to item.get, HttpMethod.Post to item.post, HttpMethod.Put to item.put,
                HttpMethod.Delete to item.delete, HttpMethod.Patch to item.patch,
            )
            for ((method, op) in ops) {
                if (op == null || op.security == null || op.security.isNotEmpty()) continue // only `security: []`
                val path = rawPath.replace(Regex("""\{[a-zA-Z]+\}"""), "1")
                val response = client.request(path) {
                    this.method = method
                    if (method == HttpMethod.Post || method == HttpMethod.Put) {
                        contentType(ContentType.Application.Json)
                        setBody("{}")
                    }
                }
                swept++
                if (response.headers["Server-Timing"] != null) leaks += "$method $path -> ${response.status}"
            }
        }
        assertTrue(swept >= 4, "the sweep must cover the login family, refresh and password reset (swept $swept)")
        assertTrue(leaks.isEmpty(), "anonymous operations leaked Server-Timing: $leaks")
    }

    private class ProductionRun(val authenticated: String?, val anonymous: String?, val warned: Boolean)

    /** Boots the production-mode application (the BootstrapTest recipe), logs in as the rotated seed admin and probes. */
    private fun production(vararg overrides: Pair<String, String>): ProductionRun {
        var run: ProductionRun? = null
        val adminPassword = "rotated-${UUID.randomUUID()}"
        val log = LogCapture(org.slf4j.Logger.ROOT_LOGGER_NAME)
        try {
            testApplication {
                configureApp(
                    "bootstrap.adminInitialPassword" to adminPassword,
                    "jwt.secret" to "strong-${UUID.randomUUID()}",
                    "security.encryption.key" to strongEncryptionKey(),
                    // The dev-default `log` mail transport is refused in production (see infra/mail).
                    "mail.transport" to "disabled",
                    // Marks requests already-HTTPS so production's HTTPS redirect does not answer first.
                    "http.behindProxy" to "true",
                    *overrides,
                )
                serverConfig { developmentMode = false }
                try {
                    startApplication()
                    val https = createClient {
                        lettuceTestClientDefaults()
                        install(DefaultRequest) { header("X-Forwarded-Proto", "https") }
                    }
                    val login = https.post("/api/v1/login") {
                        contentType(ContentType.Application.Json)
                        setBody(LoginRequest(SEED_ADMIN_EMAIL, adminPassword))
                    }
                    assertEquals(HttpStatusCode.OK, login.status)
                    assertNull(login.headers["Server-Timing"], "the login response is anonymous, whatever the override")
                    val token = login.body<LoginResponse>().token
                    val authed = https.get("/api/v1/notifications?pageSize=1") { header(HttpHeaders.Authorization, "Bearer $token") }
                    assertEquals(HttpStatusCode.OK, authed.status)
                    val anonymous = https.get("/healthz")
                    run = ProductionRun(
                        authed.headers["Server-Timing"], anonymous.headers["Server-Timing"],
                        log.events.any { "perf.serverTiming=true in production" in it.formattedMessage },
                    )
                } finally {
                    TestSeedState.restoreSeedAccounts()
                }
            }
        } finally {
            log.detach()
        }
        return checkNotNull(run)
    }

    @Test
    fun `production hides Server-Timing by default - the override exposes it to authenticated callers only and warns at boot`() {
        val default = production()
        assertNull(default.authenticated, "production must not send Server-Timing unless asked")
        assertNull(default.anonymous)
        assertTrue(!default.warned, "no warning without the override")

        val exposed = production("perf.serverTiming" to "true")
        val header = assertNotNull(exposed.authenticated, "the override exposes it on an authenticated response")
        assertTrue(headerShape.matches(header), "unexpected Server-Timing shape: $header")
        assertNull(exposed.anonymous, "even with the override an anonymous response carries nothing")
        assertTrue(exposed.warned, "a production boot with perf.serverTiming=true must warn once")
    }

    @Test
    fun `a slow request logs one line with the route path and no query string`() = testApplication {
        configureApp("perf.slowRequestMs" to "1")
        startApplication()
        val log = LogCapture("ch.nokillswit.perf")
        try {
            val secret = "query-secret-${UUID.randomUUID()}"
            val email = uniqueEmail("timing-slow").also { TestUsers.seed(it, password) }
            val response = authedClient(email, password).get("/api/v1/users?name=$secret")
            assertEquals(HttpStatusCode.OK, response.status)

            val line = log.requireEvent("slow-request line for the users list") { e -> e.hasKeyValue("path", "/api/v1/users") }
            assertEquals("request.slow", line.message)
            assertTrue(line.hasKeyValue("method", "GET"))
            assertTrue(line.hasKeyValue("status", "200"))
            val values = line.keyValuePairs.orEmpty().associate { it.key to it.value.toString() }
            assertTrue((values.getValue("stmt").toInt()) >= 1, "the list ran statements: $values")
            assertTrue(values.getValue("slowestSql").startsWith("SELECT"), "slowest SQL template: $values")
            assertTrue(values.values.none { secret in it }, "no query string or bind value may reach the log: $values")
            assertEquals(1, log.events.count { it.hasKeyValue("path", "/api/v1/users") }, "exactly one line per request")
        } finally {
            log.detach()
        }
    }

    @Test
    fun `a request under the threshold logs nothing`() = testApplication {
        configureApp("perf.slowRequestMs" to "600000")
        startApplication()
        val log = LogCapture("ch.nokillswit.perf")
        try {
            assertEquals(HttpStatusCode.OK, createClient { }.get("/healthz").status)
            Thread.sleep(300)
            assertTrue(log.events.isEmpty(), "nothing is slow at 10 minutes: ${log.describeEvents()}")
        } finally {
            log.detach()
        }
    }

    @Test
    fun `an out-of-range or malformed slow-request threshold refuses to start`() {
        for (bad in listOf("0", "600001", "soon")) {
            testApplication {
                configureApp("perf.slowRequestMs" to bad)
                assertStartupFails("perf.slowRequestMs") { startApplication() }
            }
        }
    }

    @Test
    fun `parallel requests are attributed to their own element - no cross-talk between statement counts`() = testApplication {
        configureApp()
        startApplication()
        val email = uniqueEmail("timing-parallel").also { TestUsers.seed(it, password) }
        // An unvalidated client with a bearer token: the heavy probe lists every user in the shared database, whose
        // other tests' addresses need not satisfy the spec's email pattern.
        val token = jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, password))
        }.body<LoginResponse>().token
        val client: HttpClient = createClient { install(DefaultRequest) { header(HttpHeaders.Authorization, "Bearer $token") } }
        suspend fun count(path: String) = statements(client.get(path).headers["Server-Timing"])
        val light = "/api/v1/notifications?pageSize=1"
        val heavy = "/api/v1/users?pageSize=100"
        val lightAlone = count(light)
        val heavyAlone = count(heavy)
        assertTrue(lightAlone != heavyAlone, "the two probes must differ in statement count ($lightAlone vs $heavyAlone)")

        val results = coroutineScope {
            (0 until 24).map { i -> async { (if (i % 2 == 0) "light" else "heavy") to count(if (i % 2 == 0) light else heavy) } }.awaitAll()
        }
        results.forEach { (kind, n) ->
            val expected = if (kind == "light") lightAlone else heavyAlone
            assertEquals(expected, n, "$kind request mis-attributed under concurrency")
        }
    }

    @Test
    fun `the interceptor is registered with Exposed and shares the plugin's element class`() {
        val provider = assertNotNull(
            ServiceLoader.load(GlobalSuspendStatementInterceptor::class.java).firstOrNull { it is RequestDbMetricsInterceptor },
            "RequestDbMetricsInterceptor must be discovered through META-INF/services",
        )
        // The element class must resolve to ONE Class from the interceptor's own loader and the plugin's — the
        // dev-mode reload class loader once gave them two copies (every counter stayed 0 under :server:run).
        val seenByInterceptor = Class.forName(RequestDbMetrics::class.java.name, false, provider.javaClass.classLoader)
        assertTrue(seenByInterceptor === RequestDbMetrics::class.java, "RequestDbMetrics loaded twice")
        val origin = RequestDbMetrics::class.java.protectionDomain.codeSource?.location.toString()
        assertTrue("core" in origin, "the element must be defined in the core module, not server: $origin")
    }

    @Test
    fun `the interceptor counts nothing for a transaction without an element and windows a statement over its server time`() = runBlocking {
        val database = TestServices.database
        val bystander = RequestDbMetrics() // exists, but is NOT in the coroutine context of the transaction below
        suspendTransaction(database) { exec("SELECT 1", emptyList(), StatementType.SELECT) { 1 }!!.toList() } // completes
        assertEquals(0, bystander.statements)
        assertEquals(0, bystander.transactions)

        val metrics = RequestDbMetrics()
        withContext(metrics) {
            suspendTransaction(database) {
                UserService.Users.selectAll().where { UserService.Users.email eq "nobody-${UUID.randomUUID()}@test" }.toList()
                // pg_sleep(0.3): Exposed's afterExecution fires ~10 ms in, before the server answers —
                // the statement WINDOW (dispatch to the next boundary) is what reaches ≥ 300 ms.
                exec("SELECT pg_sleep(0.3)", emptyList(), StatementType.SELECT) { 1 }!!.toList()
            }
        }
        assertEquals(2, metrics.statements)
        assertEquals(1, metrics.transactions)
        assertEquals(0, bystander.statements, "an element outside the context stays untouched by a request that has its own")
        assertTrue(metrics.dbNanos >= 290_000_000, "the sleep's window must cover the server time, was ${metrics.dbNanos / 1_000_000} ms")
        val slowest = assertNotNull(metrics.slowest)
        assertTrue("pg_sleep" in slowest.sql, "the slowest statement is the sleep: ${slowest.sql}")

        // A bind value must never reach the recorded SQL: only the `?` template does.
        val bound = RequestDbMetrics()
        val bindSecret = "bind-secret-${UUID.randomUUID()}@test"
        withContext(bound) {
            suspendTransaction(database) { UserService.Users.selectAll().where { UserService.Users.email eq bindSecret }.toList() }
        }
        val template = assertNotNull(bound.slowest).sql
        assertTrue(bindSecret !in template && "?" in template, "SQL is the template, never the bound value: $template")

        val rolledBack = RequestDbMetrics()
        runCatching { withContext(rolledBack) { suspendTransaction(database) { error("boom") } } }
        assertEquals(1, rolledBack.transactions, "a rolled-back transaction counts too")
    }
}
