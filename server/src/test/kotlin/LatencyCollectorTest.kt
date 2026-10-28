package ch.nokillswit

import ch.nokillswit.authz.TooManyRequestsException
import ch.nokillswit.plugins.KTOR_CALLS_FAMILY
import ch.nokillswit.plugins.MetricRegistryKey
import ch.nokillswit.plugins.MAX_CALL_METRIC_NAMES
import ch.nokillswit.telemetry.LatencyCollector
import ch.nokillswit.telemetry.MAX_LABEL_LENGTH
import ch.nokillswit.telemetry.MetricDef
import ch.nokillswit.telemetry.MetricGroup
import ch.nokillswit.telemetry.Reading
import ch.nokillswit.telemetry.TelemetryMetrics
import ch.nokillswit.telemetry.TelemetryOverrides
import ch.nokillswit.telemetry.TelemetryOverridesKey
import ch.nokillswit.telemetry.TelemetrySamplerKey
import ch.nokillswit.telemetry.isCounted
import ch.nokillswit.telemetry.isLabelled
import ch.nokillswit.telemetry.normaliseRoute
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.application.plugin
import io.ktor.server.response.respond
import io.ktor.server.response.respondText
import io.ktor.server.routing.HttpMethodRouteSelector
import io.ktor.server.routing.RoutingNode
import io.ktor.server.routing.RoutingRoot
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val OK_ROUTE = "/api/v1/zz-latency-ok"
private const val SLOW_ROUTE = "/api/v1/zz-latency/slow"
private const val FAILING_ROUTE = "/api/v1/zz-latency/failing"
private const val THROWING_ROUTE = "/api/v1/zz-latency/throwing"
private const val LIMITED_ROUTE = "/api/v1/zz-latency/limited"
private const val TELEMETRY_ROUTE = "/api/v1/telemetry/zz-latency"
private const val PAGE_ROUTE = "/zz-latency-page"
private const val HANDLER_DELAY_MILLIS = 25L

// meter + timer + ten statuses: the worst case the registry cap is sized for.
private const val NAMES_PER_LEAF_WORST_CASE = 12

/**
 * `telemetry/LatencyCollector.kt` over a real `testApplication`: Ktor's Dropwizard series become per-route and `*` rows (count and
 * 5xx/429 deltas, p50/p95 of the windowed timers), the telemetry's own routes and non-API paths stay out of the total, the
 * series-name normalisation and the label rule (D4: every counted route is labelled) are pinned against the names Ktor 3.6 really
 * writes for Lettuce's routes and the real routing tree (so an upgrade that renames them, or a route that changes shape, fails here
 * instead of silently emptying the panel), and every real rate-limited route counts each 429 once
 * (`.claude/docs/features/telemetry.md` "Requests": no surplus correction is needed).
 */
class LatencyCollectorTest {
    private val store = telemetryStore()

    @BeforeTest
    fun emptyTelemetry() = runBlocking { wipeTelemetry(store) }

    private fun Application.syntheticRoutes() {
        routing {
            get(OK_ROUTE) { call.respondText("ok") }
            get(SLOW_ROUTE) {
                delay(HANDLER_DELAY_MILLIS)
                call.respondText("graph")
            }
            get(FAILING_ROUTE) { call.respond(HttpStatusCode.InternalServerError) }
            get(THROWING_ROUTE) { error("boom") }
            get(LIMITED_ROUTE) { throw TooManyRequestsException("slow down") }
            get(TELEMETRY_ROUTE) { call.respondText("t") }
            get(PAGE_ROUTE) { call.respondText("page") }
        }
    }

    private fun List<Reading>.value(metric: MetricDef, label: String): Double? =
        firstOrNull { it.metric == metric && it.label == label }?.value

    /** One interval's readings, committed as the sampler does once they are stored. */
    private fun LatencyCollector.take(): List<Reading> = collect().also { commit() }

    /** A started application with the synthetic routes and a collector over its registry, whose baseline (startup traffic) is taken. */
    private fun withCollector(
        vararg overrides: Pair<String, String>,
        block: suspend ApplicationTestBuilder.(LatencyCollector) -> Unit,
    ) = testApplication {
        configureApp(*overrides)
        application { syntheticRoutes() }
        startApplication()
        val collector = LatencyCollector(application.attributes[MetricRegistryKey])
        collector.take()
        block(collector)
    }

    @Test
    fun `a route's count and percentiles come from its timer, the total adds every counted route`() = withCollector { collector ->
        repeat(4) { client.get(SLOW_ROUTE) }
        repeat(2) { client.get(OK_ROUTE) }

        val readings = collector.take()
        assertEquals(4.0, readings.value(TelemetryMetrics.HTTP_COUNT, SLOW_ROUTE))
        val p50 = assertNotNull(readings.value(TelemetryMetrics.HTTP_P50, SLOW_ROUTE))
        val p95 = assertNotNull(readings.value(TelemetryMetrics.HTTP_P95, SLOW_ROUTE))
        assertTrue(p50 >= HANDLER_DELAY_MILLIS - 5 && p95 >= p50, "milliseconds of a $HANDLER_DELAY_MILLIS ms handler: p50 $p50 p95 $p95")
        assertEquals(6.0, readings.value(TelemetryMetrics.HTTP_COUNT, "*"))
        val totalP95 = assertNotNull(readings.value(TelemetryMetrics.HTTP_P95, "*"))
        assertTrue(totalP95 >= p50, "the total's percentile spans every route's observations")
        assertEquals(2.0, readings.value(TelemetryMetrics.HTTP_COUNT, OK_ROUTE), "every counted route has a label of its own")
    }

    @Test
    fun `counts are deltas of the previous collection, and a label with nothing new has no row`() = withCollector { collector ->
        repeat(3) { client.get(SLOW_ROUTE) }
        assertEquals(3.0, collector.take().value(TelemetryMetrics.HTTP_COUNT, SLOW_ROUTE))
        assertEquals(emptyList(), collector.take().filter { it.label == SLOW_ROUTE }, "an idle interval writes nothing for the route")
        client.get(SLOW_ROUTE)
        assertEquals(1.0, collector.take().value(TelemetryMetrics.HTTP_COUNT, SLOW_ROUTE), "the next interval's own delta")
    }

    @Test
    fun `5xx and 429 responses are counted per route and in the total, a thrown 429 once`() = withCollector { collector ->
        repeat(2) { client.get(FAILING_ROUTE) }
        client.get(THROWING_ROUTE)
        repeat(3) { client.get(LIMITED_ROUTE) }

        val readings = collector.take()
        assertEquals(2.0, readings.value(TelemetryMetrics.HTTP_5XX, FAILING_ROUTE))
        assertEquals(1.0, readings.value(TelemetryMetrics.HTTP_5XX, THROWING_ROUTE), "a thrown exception is one 5xx")
        assertNull(readings.value(TelemetryMetrics.HTTP_429, FAILING_ROUTE))
        assertEquals(3.0, readings.value(TelemetryMetrics.HTTP_429, LIMITED_ROUTE), "TooManyRequestsException is answered once")
        assertEquals(3.0, readings.value(TelemetryMetrics.HTTP_5XX, "*"))
        assertEquals(3.0, readings.value(TelemetryMetrics.HTTP_429, "*"))
        assertEquals(6.0, readings.value(TelemetryMetrics.HTTP_COUNT, "*"))
        assertEquals(3.0, readings.value(TelemetryMetrics.HTTP_COUNT, LIMITED_ROUTE), "the request count is the timer's, never doubled")
    }

    @Test
    fun `the telemetry's own routes, the probes and non-API paths stay out of the total`() = withCollector { collector ->
        repeat(3) { client.get(TELEMETRY_ROUTE) }
        repeat(2) { client.get(PAGE_ROUTE) }
        repeat(4) { client.get("/healthz") }
        client.get("/readyz")
        assertEquals(emptyList(), collector.take().filter { it.metric.group == MetricGroup.REQUESTS })

        client.get(OK_ROUTE)
        assertEquals(1.0, collector.take().value(TelemetryMetrics.HTTP_COUNT, "*"))
    }

    @Test
    fun `an unrouted request leaves no row and registers no instrument`() = withCollector { collector ->
        client.get(SLOW_ROUTE)
        collector.take()
        val before = application.attributes[MetricRegistryKey].names.filter { it.startsWith(KTOR_CALLS_FAMILY) }.toSet()
        client.get("/api/v1/zz-latency-unknown?q=1")
        client.get("/api/v1/zz-latency-unknown/graph")
        val readings = collector.take()
        assertEquals(emptyList(), readings.filter { it.label.contains("unknown") })
        assertNull(readings.value(TelemetryMetrics.HTTP_COUNT, SLOW_ROUTE))
        val after = application.attributes[MetricRegistryKey].names.filter { it.startsWith(KTOR_CALLS_FAMILY) }.toSet()
        assertEquals(emptySet(), (after - before).filterNot { it.startsWith("${KTOR_CALLS_FAMILY}status.") }.toSet())
    }

    /**
     * The 429 correction Flow needed does not exist here (`.claude/docs/features/telemetry.md` "Requests"): Ktor marks the RateLimit
     * plugin's bodiless 429 and StatusPages' re-answer of it, and the re-answer lands in the routed name's `429` meter a second time
     * only on a route whose name equals its URI (no selector, no path parameter, no query string). Every rate-limited Lettuce route
     * carries the `(RateLimit x)` selector, so the re-answer falls back to a URI name `TelemetryRegistry` refuses - each rejection
     * counts once, with or without a query string, and the timer count (the request count) equals the meters'.
     */
    @Test
    fun `the login route counts each 429 once, a query string notwithstanding`() = withCollector(
        "security.rateLimit.loginPerMinute" to "1",
    ) { collector ->
        val path = "/api/v1/login"
        client.post(path) // admitted (a 400/401: no body)
        val rejected = listOf(path, "$path?probe=a", "$path?probe=b").map { client.post(it).status }
        assertEquals(listOf(HttpStatusCode.TooManyRequests), rejected.distinct(), path)
        val readings = collector.take()
        assertEquals(3.0, readings.value(TelemetryMetrics.HTTP_429, "*"), "$path: three rejections, not six")
        assertEquals(4.0, readings.value(TelemetryMetrics.HTTP_COUNT, "*"), "$path: one admitted + three rejected")
        assertTrue(readings.none { '?' in it.label }, "no label carries a query string: ${readings.map { it.label }}")
    }

    /** Refresh (30/min), password reset (5/min) and the MFA step (10/min) have a fixed bucket: exhaust it, then reject some more. */
    @Test
    fun `the fixed-limit refresh, password-reset and MFA routes count each 429 once, a query string notwithstanding`() =
        withCollector { collector ->
            for ((path, limit) in listOf("/api/v1/refresh" to 30, "/api/v1/password-reset" to 5, "/api/v1/login/mfa" to 10)) {
                repeat(limit) { client.post(path) } // admitted: 400s (no body)
                val rejected = listOf(path, "$path?probe=a", "$path?probe=b").map { client.post(it).status }
                assertEquals(listOf(HttpStatusCode.TooManyRequests), rejected.distinct(), path)
                val readings = collector.take()
                assertEquals(3.0, readings.value(TelemetryMetrics.HTTP_429, "*"), "$path: three rejections, not six")
                assertEquals(limit + 3.0, readings.value(TelemetryMetrics.HTTP_COUNT, "*"), "$path: $limit admitted + three rejected")
                assertEquals(3.0, readings.value(TelemetryMetrics.HTTP_429, path), "$path: counted under its own label")
            }
        }

    /** The two per-CALLER sharing buckets (keyed on the JWT userId): the single share and the mass share, each limited to one. */
    @Test
    fun `the per-caller share routes count each 429 once, a query string notwithstanding`() = withCollector(
        "sharing.rateLimitPerMinute" to "1",
        "sharing.batchRateLimitPerMinute" to "1",
    ) { collector ->
        val email = uniqueEmail("telemetry-share")
        TestUsers.seed(email, "pw-telemetry", roles = emptySet())
        val caller = authedClient(email, "pw-telemetry")
        collector.take() // the login above is not under test
        for (path in listOf("/api/v1/shares", "/api/v1/shares/batch")) {
            caller.post(path) // admitted: a 400 (no body)
            val rejected = listOf(path, "$path?probe=a", "$path?probe=b").map { caller.post(it).status }
            assertEquals(listOf(HttpStatusCode.TooManyRequests), rejected.distinct(), path)
            val readings = collector.take()
            assertEquals(3.0, readings.value(TelemetryMetrics.HTTP_429, "*"), "$path: three rejections, not six")
            assertEquals(4.0, readings.value(TelemetryMetrics.HTTP_COUNT, "*"), "$path: one admitted + three rejected")
            assertEquals(3.0, readings.value(TelemetryMetrics.HTTP_429, path), "$path: counted under its own label")
        }
    }

    @Test
    fun `the integration routes are labelled and each 429 counts once`() = withCollector(
        "integration.enabled" to "true",
        "integration.rateLimitPerMinute" to "2",
    ) { collector ->
        repeat(2) { client.post("/integration/graphql") } // 401s: admitted, then unauthenticated
        repeat(3) { client.post("/integration/graphql?i=$it") }
        repeat(2) { client.get("/integration/graphql/schema") }

        val readings = collector.take()
        assertEquals(5.0, readings.value(TelemetryMetrics.HTTP_COUNT, "/integration/graphql"))
        assertEquals(3.0, readings.value(TelemetryMetrics.HTTP_429, "/integration/graphql"))
        assertEquals(2.0, readings.value(TelemetryMetrics.HTTP_429, "/integration/graphql/schema"))
        assertEquals(7.0, readings.value(TelemetryMetrics.HTTP_COUNT, "*"), "/integration/ routes are counted in the total")
        assertEquals(5.0, readings.value(TelemetryMetrics.HTTP_429, "*"))
    }

    @Test
    fun `route normalisation drops the selectors Ktor puts in a series name`() {
        val auth = "/(authenticate \"default\")"
        assertEquals("/api/v1/users", normaliseRoute("$auth/api/v1/users/(method:GET)"))
        assertEquals("/api/v1/users/{id}", normaliseRoute("$auth/api/v1/users/{id}/(method:GET)"))
        assertEquals("/api/v1/login", normaliseRoute("/(RateLimit login)/api/v1/login/(method:POST)"))
        assertEquals("/integration/graphql/schema", normaliseRoute("/(RateLimit integration)/integration/graphql/schema/(method:GET)"))
        assertEquals("/healthz", normaliseRoute("/healthz/(method:GET)"))
        assertEquals("/", normaliseRoute("/(method:GET)"))
    }

    @Test
    fun `the series Ktor really writes normalise to the labels the panel will read`() = withCollector { collector ->
        client.get("/api/v1/users") // anonymous: routed under `authenticate`, answered 401
        client.get("/api/v1/users/1")
        val names = application.attributes[MetricRegistryKey].timers.keys
        // The raw names, with the whole selector chain: if Ktor stops writing them this way the normaliser's input has changed.
        val list = names.single { it.endsWith("/api/v1/users/(method:GET).timer") }
        assertEquals("ktor.calls./(authenticate \"default\")/api/v1/users/(method:GET).timer", list)
        assertEquals("/api/v1/users", normaliseRoute(list.removePrefix(KTOR_CALLS_FAMILY).removeSuffix(".timer")))
        val byId = names.single { it.contains("/api/v1/users/{id}/(method:GET)") }
        val byIdRoute = normaliseRoute(byId.removePrefix(KTOR_CALLS_FAMILY).removeSuffix(".timer"))
        assertEquals("/api/v1/users/{id}", byIdRoute, "{id} stays literal")
        assertTrue(names.none { it.contains("/users/1/") || it.contains("/users/1.") }, "no concrete identifier in a route name: $names")
        val readings = collector.take()
        assertEquals(1.0, readings.value(TelemetryMetrics.HTTP_COUNT, "/api/v1/users"))
        assertEquals(1.0, readings.value(TelemetryMetrics.HTTP_COUNT, "/api/v1/users/{id}"), "{id} is the label, never the identifier")
        assertEquals(2.0, readings.value(TelemetryMetrics.HTTP_COUNT, "*"))
    }

    /** Every leaf of the routing tree (one per path+method), named the way Ktor names it in a series. */
    private fun RoutingNode.leaves(): List<String> =
        children.flatMap { child -> if (child.selector is HttpMethodRouteSelector) listOf(child.toString()) else child.leaves() }

    @Test
    fun `every counted route of the real routing tree is labelled, within the column and registry bounds`() = testApplication {
        configureApp("integration.enabled" to "true")
        startApplication()
        val leaves = application.plugin(RoutingRoot).leaves()
        val routes = leaves.map(::normaliseRoute).distinct()
        assertTrue(routes.size > 50, "the walk found the application's routes: ${routes.size}")

        val counted = routes.filter { isCounted(it) }.sorted()
        assertEquals(counted, routes.filter { isLabelled(it) }.sorted(), "D4: the labelled set IS the counted set")
        for (known in listOf("/api/v1/login", "/api/v1/users", "/api/v1/users/{id}", "/api/v1/shares/batch", "/integration/graphql")) {
            assertTrue(known in counted, "$known is counted and labelled: $counted")
        }
        // A label is a stored VARCHAR(120): a longer route template would be cut, and two cut ones would collide on the primary key.
        assertEquals(emptyList(), counted.filter { it.length > MAX_LABEL_LENGTH })
        // The registry names instruments per routed LEAF (path + method), not per label: a meter, a timer and one name per status
        // seen. Ten statuses per leaf (200/201/204/400/401/403/404/409/429/500) is a generous worst case; past the cap a route first
        // hit later would get a detached timer and drop out of the total, not just its label.
        val worstCase = leaves.size * NAMES_PER_LEAF_WORST_CASE
        assertTrue(worstCase < MAX_CALL_METRIC_NAMES, "${leaves.size} routed leaves (~$worstCase names) would crowd the registry cap")
        assertTrue(routes.none { isCounted(it) && it.startsWith("/api/v1/telemetry") })
        assertFalse(isCounted("/healthz") || isCounted("/readyz") || isCounted("/"), "probes and the SPA are not API traffic")
    }

    @Test
    fun `the label rule is the count rule - API and integration routes, never the telemetry's own`() {
        for (route in listOf("/api/v1/zz/graph", "/api/v1/files", "/api/v1/zz/{id}/sync", "/api/v1/login", "/integration/anything")) {
            assertTrue(isCounted(route) && isLabelled(route), route)
        }
        for (route in listOf("/api/v1/telemetry", "/api/v1/telemetry/current", "/healthz", "/readyz", "/", "/assets/app.js")) {
            assertFalse(isCounted(route) || isLabelled(route), route)
        }
        assertTrue(isCounted("/api/v1/telemetryx"), "only the telemetry API itself is excluded, not a prefix of its name")
    }

    private fun runSampler(): Pair<Set<String>, Set<String>> = runBlocking {
        val identity = testIdentity()
        lateinit var app: Application
        var labels = emptySet<String>()
        var metrics = emptySet<String>()
        testApplication {
            configureApp("telemetry.enabled" to "true")
            application {
                app = this
                syntheticRoutes()
                attributes.put(TelemetryOverridesKey, TelemetryOverrides(identity = identity, firstTickDelayMillis = Long.MAX_VALUE / 4))
            }
            startApplication()
            client.get(SLOW_ROUTE)
            assertNotNull(app.attributes.getOrNull(TelemetrySamplerKey)).tick()
            val rows = store.samples(assertNotNull(store.processId(identity))).filter { it.metric.startsWith("http.") }
            labels = rows.map { it.label }.toSet()
            metrics = rows.map { it.metric }.toSet()
        }
        labels to metrics
    }

    @Test
    fun `a sampled process writes its request rows`() {
        val (labels, metrics) = runSampler()
        assertEquals(setOf("*", SLOW_ROUTE), labels)
        assertTrue("http.count" in metrics && "http.p50" in metrics && "http.p95" in metrics, "$metrics")
    }
}
