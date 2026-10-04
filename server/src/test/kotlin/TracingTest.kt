package ch.nokillswit

import ch.nokillswit.infra.db.tracedConnectionFactory
import ch.nokillswit.plugins.DbSpansEnabledKey
import ch.nokillswit.plugins.OpenTelemetryKey
import ch.nokillswit.plugins.tracesExporterConfigured
import io.ktor.client.request.get
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import io.opentelemetry.api.OpenTelemetry
import io.opentelemetry.api.trace.SpanKind
import io.opentelemetry.sdk.OpenTelemetrySdk
import io.opentelemetry.sdk.autoconfigure.spi.ConfigProperties
import io.opentelemetry.sdk.autoconfigure.spi.traces.ConfigurableSpanExporterProvider
import io.opentelemetry.sdk.common.CompletableResultCode
import io.opentelemetry.sdk.trace.data.SpanData
import io.opentelemetry.sdk.trace.export.SpanExporter
import io.r2dbc.spi.ConnectionFactories
import io.r2dbc.spi.ConnectionFactoryOptions
import kotlinx.coroutines.delay
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNotSame
import kotlin.test.assertSame
import kotlin.test.assertTrue

/** Test-only exporter the autoconfigured SDK is pointed at (`otel.traces.exporter=lettuce-test-collector`). */
object SpanCollector : SpanExporter {
    val spans = CopyOnWriteArrayList<SpanData>()

    override fun export(spans: MutableCollection<SpanData>): CompletableResultCode {
        this.spans.addAll(spans)
        return CompletableResultCode.ofSuccess()
    }

    override fun flush(): CompletableResultCode = CompletableResultCode.ofSuccess()

    override fun shutdown(): CompletableResultCode = CompletableResultCode.ofSuccess()
}

/** Registered via `META-INF/services` in the TEST resources only; inert unless a test selects it by name. */
class CollectingSpanExporterProvider : ConfigurableSpanExporterProvider {
    override fun createExporter(config: ConfigProperties): SpanExporter = SpanCollector

    override fun getName(): String = "lettuce-test-collector"
}

/**
 * DB spans (M4 step 12): the Ktor server span is the parent of the R2DBC client spans the wrapped pool emits
 * for the statements of that request — the request's trace is one tree, the within-request waterfall the perf
 * harness reads in Jaeger (`.claude/docs/performance.md`). The SDK is the autoconfigured one with the test
 * collector as its exporter; production's default exporter stays `none`.
 */
class TracingTest {

    private val password = "pw-tracing-1234"

    private suspend fun awaitSpans(sdk: OpenTelemetrySdk, ready: (List<SpanData>) -> Boolean): List<SpanData> {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        while (true) {
            sdk.sdkTracerProvider.forceFlush().join(5, TimeUnit.SECONDS)
            val snapshot = SpanCollector.spans.toList()
            if (ready(snapshot) || System.nanoTime() >= deadline) return snapshot
            delay(50)
        }
    }

    private fun withExporterProperty(value: String?, block: () -> Unit) {
        val previous = System.getProperty("otel.traces.exporter")
        if (value == null) System.clearProperty("otel.traces.exporter") else System.setProperty("otel.traces.exporter", value)
        try {
            block()
        } finally {
            if (previous == null) System.clearProperty("otel.traces.exporter") else System.setProperty("otel.traces.exporter", previous)
        }
    }

    @Test
    fun `DB spans are enabled only when a traces exporter other than none is configured`() {
        withExporterProperty("none") { assertFalse(tracesExporterConfigured()) }
        withExporterProperty("") { assertTrue(tracesExporterConfigured()) } // SDK: empty -> its default otlp
        withExporterProperty("otlp") { assertTrue(tracesExporterConfigured()) }
        withExporterProperty("none, OTLP") { assertTrue(tracesExporterConfigured()) }
        // No property: the env var / core's default (none) decide — the test JVM has no OTEL_TRACES_EXPORTER.
        if (System.getenv("OTEL_TRACES_EXPORTER") == null) withExporterProperty(null) { assertFalse(tracesExporterConfigured()) }
    }

    @Test
    fun `the default boot does not wrap the connection factory`() = testApplication {
        configureApp()
        startApplication()
        assertEquals(false, application.attributes[DbSpansEnabledKey], "the default (exporter none) must keep the pre-M4 path")

        // Building a factory does not connect: a bare PostgreSQL factory stands in for the pool.
        val options = ConnectionFactoryOptions.parse("r2dbc:postgresql://localhost/none").mutate()
            .option(ConnectionFactoryOptions.USER, "u").option(ConnectionFactoryOptions.PASSWORD, "p").build()
        val pool = ConnectionFactories.get(options)
        assertSame(pool, tracedConnectionFactory(pool, options, false) { error("must not be read when disabled") })
        assertNotSame(pool, tracedConnectionFactory(pool, options, true) { OpenTelemetry.noop() })
    }

    @Test
    fun `a request's server span parents the DB client spans of its statements`() = testApplication {
        val previous = System.getProperty("otel.traces.exporter")
        System.setProperty("otel.traces.exporter", "lettuce-test-collector")
        try {
            configureApp()
            startApplication()
            val sdk = application.attributes[OpenTelemetryKey] as OpenTelemetrySdk
            assertEquals(true, application.attributes[DbSpansEnabledKey], "a configured exporter turns DB spans on")
            val adminEmail = uniqueEmail("tracing-admin")
            TestUsers.seed(adminEmail, password, name = "Tracing Admin")
            val targetId = TestUsers.seed(uniqueEmail("tracing-target"), password, name = "Tracing Target")
            val client = authedClient(adminEmail, password)
            awaitSpans(sdk) { true } // drain the login's spans
            SpanCollector.spans.clear()

            val path = "/api/v1/users/$targetId"
            assertEquals(HttpStatusCode.OK, client.get(path).status)

            fun serverSpans(all: List<SpanData>) = all.filter { it.kind == SpanKind.SERVER }
            val spans = awaitSpans(sdk) { all -> serverSpans(all).isNotEmpty() && all.any { it.kind == SpanKind.CLIENT } }
            val server = assertNotNull(serverSpans(spans).singleOrNull(), "exactly one SERVER span per request: $spans")
            val db = spans.filter { it.kind == SpanKind.CLIENT }
            assertTrue(db.isNotEmpty(), "the request's statements must produce DB client spans: ${spans.map { it.name }}")
            val byId = spans.associateBy { it.spanId }
            for (span in db) {
                assertEquals(server.traceId, span.traceId, "DB span '${span.name}' left the request's trace (orphaned)")
                val ancestors = generateSequence(byId[span.parentSpanId]) { byId[it.parentSpanId] }.map { it.spanId }.toList()
                assertTrue(server.spanId in ancestors, "DB span '${span.name}' is not a descendant of the server span")
            }
            assertTrue(db.any { it.parentSpanId == server.spanId }, "at least one DB span must hang directly off the server span")
        } finally {
            if (previous == null) System.clearProperty("otel.traces.exporter") else System.setProperty("otel.traces.exporter", previous)
        }
    }
}
