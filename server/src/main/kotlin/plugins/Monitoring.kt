package ch.nokillswit.plugins

import io.ktor.server.application.*
import com.codahale.metrics.*
import io.ktor.server.metrics.dropwizard.*
import org.slf4j.LoggerFactory
import java.util.concurrent.TimeUnit
import io.ktor.http.*
import io.ktor.server.plugins.callid.*
import io.ktor.server.response.*

fun Application.configureMonitoring() {
    install(DropwizardMetrics) {
        val reporter = Slf4jReporter.forRegistry(registry)
            .outputTo(LoggerFactory.getLogger("metrics"))
            .convertRatesTo(TimeUnit.SECONDS)
            .convertDurationsTo(TimeUnit.MILLISECONDS)
            .build()
        reporter.start(10, TimeUnit.SECONDS)
        // The reporter owns a scheduler thread: stop it with the application, or every
        // testApplication boot (and any in-process restart) leaks one (checkup #38 A5).
        this@configureMonitoring.monitor.subscribe(ApplicationStopped) { reporter.stop() }
    }
    install(CallId) {
        header(HttpHeaders.XRequestId)
        verify { callId: String ->
            callId.isNotEmpty()
        }
    }
}
