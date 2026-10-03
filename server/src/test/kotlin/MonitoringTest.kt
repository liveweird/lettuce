package ch.nokillswit

import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * plugins/Monitoring.kt: the Dropwizard `Slf4jReporter` runs on its own scheduler thread
 * ("metrics-logger-reporter-N"); it must stop with the application instead of leaking one thread
 * per boot (checkup #38 A5).
 */
class MonitoringTest {

    private fun reporterThreads() =
        Thread.getAllStackTraces().keys.count { it.isAlive && it.name.startsWith("metrics-logger-reporter") }

    @Test
    fun `the metrics reporter thread is shut down when the application stops`() {
        val before = reporterThreads()
        testApplication {
            configureApp()
            startApplication()
            assertEquals(before + 1, reporterThreads(), "the reporter runs while the application is up")
        }
        // executor.shutdown() lets the idle worker exit asynchronously — poll briefly.
        val deadline = System.nanoTime() + 5_000_000_000L
        while (reporterThreads() > before && System.nanoTime() < deadline) Thread.sleep(50)
        assertTrue(reporterThreads() <= before, "the reporter thread must not outlive the application")
    }
}
