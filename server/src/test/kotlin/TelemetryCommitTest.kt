package ch.nokillswit

import ch.nokillswit.telemetry.CgroupProbe
import ch.nokillswit.telemetry.JvmProbe
import ch.nokillswit.telemetry.LatencyCollector
import ch.nokillswit.telemetry.MetricDef
import ch.nokillswit.telemetry.MetricGroup
import ch.nokillswit.telemetry.MetricKind
import ch.nokillswit.telemetry.MetricUnit
import ch.nokillswit.telemetry.ProcessCollector
import ch.nokillswit.telemetry.Reading
import ch.nokillswit.telemetry.TelemetryMetrics
import ch.nokillswit.telemetry.TelemetryConfig
import ch.nokillswit.telemetry.TelemetrySampler
import com.codahale.metrics.MetricRegistry
import kotlinx.coroutines.runBlocking
import java.nio.file.Path
import java.util.concurrent.TimeUnit
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val GRAPH = "/(authenticate \"default\")/api/v1/zz-commit/graph/(method:GET)"

/**
 * The sampler advances a delta baseline only for what it stored (`TelemetrySampler.collectLight`): when a tick's insert fails, the
 * interval's server errors are not lost - the next successful tick reports both intervals - and a collector that threw is never
 * committed, nor is one consumed by another's failure.
 */
class TelemetryCommitTest {
    private val store = telemetryStore()
    private val identity = testIdentity()
    private val interval = 300_000L
    private val config = TelemetryConfig(enabled = true, sampleIntervalSeconds = 300, storageIntervalSeconds = 3600)
    private var now = 1_800_000_000_000L + 123_456

    /** A metric whose name Postgres refuses (a NUL byte), so a tick that carries it fails its whole insert. */
    private val poison = MetricDef("poison\u0000", MetricKind.GAUGE, MetricUnit.COUNT, MetricGroup.JVM)
    private var poisoned = false

    @BeforeTest
    fun emptyTelemetry() = runBlocking { wipeTelemetry(store) }

    private fun sampler(vararg extra: ProcessCollector) = TelemetrySampler(
        store, config, { identity }, { now }, JvmProbe(),
        CgroupProbe(Path.of("/nonexistent/cgroup"), Path.of("/nonexistent/status"), Path.of("/nonexistent/proc-cgroup")),
        { null }, listOf(ProcessCollector("poison") { if (poisoned) listOf(Reading(poison, 1.0)) else emptyList() }) + extra,
    )

    private suspend fun rows(metric: String) = store.samples(assertNotNull(store.processId(identity)), metric = metric)

    /** The `*` (all routes) label's rows of a request metric. */
    private suspend fun total(metric: String) = rows(metric).filter { it.label == "*" }

    @Test
    fun `a failed insert loses no interval - the next tick reports both`() = runBlocking {
        val registry = MetricRegistry()
        val latency = LatencyCollector(registry)
        val sampler = sampler(ProcessCollector("latency", commit = latency::commit) { latency.collect() })
        fun fiveHundreds(count: Int) = repeat(count) {
            registry.timer("ktor.calls.$GRAPH.timer").update(5, TimeUnit.MILLISECONDS)
            registry.meter("ktor.calls.$GRAPH.500").mark()
        }

        // Interval 1: two 5xx - and the write fails.
        fiveHundreds(2)
        poisoned = true
        sampler.tick()
        assertEquals(emptyList(), total("http.5xx"), "nothing was stored")

        // Interval 2: one more; the write succeeds and carries both intervals.
        now += interval
        poisoned = false
        fiveHundreds(1)
        sampler.tick()
        assertEquals(listOf(3.0), total("http.5xx").map { it.avg }, "2 + 1 server errors")
        assertEquals(listOf(3.0), total("http.count").map { it.avg })

        // Interval 3: committed - nothing is reported twice.
        now += interval
        sampler.tick()
        assertEquals(listOf(3.0), total("http.5xx").map { it.avg }, "no new 5xx row")
    }

    @Test
    fun `a collector that threw is not committed and a failed insert commits nobody`() = runBlocking {
        val committed = mutableListOf<String>()
        val sampler = sampler(
            ProcessCollector("good", commit = { committed += "good" }) { listOf(Reading(poisonFree, 1.0)) },
            ProcessCollector("throws", commit = { committed += "throws" }) { error("kaboom") },
        )
        poisoned = true
        sampler.tick()
        assertEquals(emptyList(), committed, "the insert failed: no baseline advances")

        now += interval
        poisoned = false
        sampler.tick()
        assertTrue("good" in committed, "the collector that produced rows is committed")
        assertNull(committed.find { it == "throws" }, "the collector that threw keeps its baseline")
        assertEquals(1, committed.count { it == "good" })
    }

    @Test
    fun `a tick at or before the newest stored bucket is skipped, so a clock step back loses no interval`() = runBlocking {
        var cumulative = 2L
        var committedBaseline = 0L
        var collects = 0
        // A delta collector in the requests mould: it reports the growth since its last COMMITTED baseline.
        var pendingBaseline = 0L
        val sampler = sampler(
            ProcessCollector("delta", commit = { committedBaseline = pendingBaseline }) {
                collects++
                pendingBaseline = cumulative
                listOf(Reading(TelemetryMetrics.HTTP_429, (cumulative - committedBaseline).toDouble(), "delta-test"))
            },
        )
        sampler.tick() // bucket B: stored, baseline = 2
        assertEquals(listOf(2.0), rows("http.429").map { it.avg })
        assertEquals(1, collects)

        cumulative = 5
        now -= interval // the wall clock stepped back one bucket
        sampler.tick()
        assertEquals(1, collects, "nothing collected for a bucket that is not newer")
        now += interval + 10_000 // back in bucket B (a second tick there) - also skipped
        sampler.tick()
        assertEquals(1, collects)
        assertEquals(listOf(2.0), rows("http.429").map { it.avg }, "nothing stored, nothing committed")

        now += interval // bucket B+1: the skipped ticks' growth rolls into it
        sampler.tick()
        assertEquals(listOf(2.0, 3.0), rows("http.429").sortedBy { it.ts }.map { it.avg })
    }

    private val poisonFree = MetricDef("commit.test", MetricKind.GAUGE, MetricUnit.COUNT, MetricGroup.JVM)
}
