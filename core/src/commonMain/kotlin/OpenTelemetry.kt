package ch.nokillswit

import io.opentelemetry.api.OpenTelemetry
import io.opentelemetry.sdk.autoconfigure.AutoConfiguredOpenTelemetrySdk
import io.opentelemetry.semconv.ServiceAttributes

/** The traces exporter the SDK defaults to (and the server's DB-span gating compares against): none — spans are not exported. */
const val DEFAULT_TRACES_EXPORTER = "none"

fun getOpenTelemetry(serviceName: String): OpenTelemetry =
    AutoConfiguredOpenTelemetrySdk.builder()
        // Defaults via addPropertiesSupplier (lowest precedence) so OTEL_* env vars can override —
        // e.g. flip OTEL_LOGS_EXPORTER=otlp later to ship logs to a collector with no code change.
        .addPropertiesSupplier {
            mapOf(
                "otel.metrics.exporter" to "none",
                "otel.traces.exporter" to DEFAULT_TRACES_EXPORTER,
                "otel.logs.exporter" to "console", // interim: System.out; overridable by OTEL_LOGS_EXPORTER
            )
        }
        .addResourceCustomizer { oldResource, _ ->
            oldResource.toBuilder()
                .putAll(oldResource.attributes)
                .put(ServiceAttributes.SERVICE_NAME, serviceName)
                .build()
        }
        .build()
        .openTelemetrySdk
