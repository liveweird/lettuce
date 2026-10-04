package ch.nokillswit.plugins

import ch.nokillswit.DEFAULT_TRACES_EXPORTER
import ch.nokillswit.getOpenTelemetry
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.util.AttributeKey
import io.opentelemetry.api.OpenTelemetry
import io.opentelemetry.instrumentation.ktor.v3_0.KtorServerTelemetry
import io.opentelemetry.instrumentation.logback.appender.v1_0.OpenTelemetryAppender

/**
 * The one OpenTelemetry SDK of the process, published by [configureOpenTelemetry] so later modules (today
 * `infra/db/Database.kt`, which wraps the R2DBC pool for DB spans) share it instead of building a second one.
 */
val OpenTelemetryKey = AttributeKey<OpenTelemetry>("OpenTelemetry")

/**
 * True when the effective `otel.traces.exporter` is anything but `none` — resolved exactly as the SDK
 * autoconfigure does (system property, then `OTEL_TRACES_EXPORTER`, then core's default [DEFAULT_TRACES_EXPORTER]).
 * Gates the DB-span wrapper: it costs CPU per statement even when nothing is exported (FINDINGS F18), so the shipped
 * default path (exporter `none`) must not pay it.
 */
internal fun tracesExporterConfigured(): Boolean {
    val raw = System.getProperty("otel.traces.exporter") ?: System.getenv("OTEL_TRACES_EXPORTER") ?: DEFAULT_TRACES_EXPORTER
    return raw.split(',').map { it.trim().lowercase() }.any { it.isNotEmpty() && it != "none" }
}

/** Whether `infra/db/Database.kt` wraps the pool with the R2DBC span instrumentation (see [tracesExporterConfigured]). */
val DbSpansEnabledKey = AttributeKey<Boolean>("DbSpansEnabled")

fun Application.configureOpenTelemetry() {
    val openTelemetry = getOpenTelemetry(serviceName = "lettuce")
    attributes.put(OpenTelemetryKey, openTelemetry)
    attributes.put(DbSpansEnabledKey, tracesExporterConfigured())
    // Wire the Logback OTel appender to this SDK; flushes the pre-install buffer of boot logs.
    OpenTelemetryAppender.install(openTelemetry)

    install(KtorServerTelemetry) {
        setOpenTelemetry(openTelemetry)
        capturedRequestHeaders(HttpHeaders.UserAgent)
        attributesExtractor {
            onStart {
                attributes.put("start-time", System.currentTimeMillis())
            }
            onEnd {
                attributes.put("end-time", System.currentTimeMillis())
            }
        }
    }
}
