package ch.nokillswit.plugins

import ch.nokillswit.infra.config.requireConfigInt
import ch.nokillswit.infra.db.RequestDbMetrics
import ch.nokillswit.infra.db.RequestDbMetricsInterceptor
import io.ktor.server.application.*
import io.ktor.server.application.hooks.ResponseSent
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.principal
import io.ktor.server.request.path
import io.ktor.util.AttributeKey
import kotlinx.coroutines.withContext
import org.jetbrains.exposed.v1.r2dbc.statements.GlobalSuspendStatementInterceptor
import org.slf4j.LoggerFactory
import java.util.Locale
import java.util.ServiceLoader

/**
 * Per-request DB metrics (measurement only — "Per-request DB metrics" in
 * `.claude/docs/observability.md`, the perf harness in `.claude/docs/performance.md`).
 *
 * Every request runs inside one [RequestDbMetrics] coroutine-context element (installed in the Setup
 * phase, so the JWT validation's blocklist read and every route transaction are covered), which
 * `RequestDbMetricsInterceptor` fills. Two outputs:
 *  - the `Server-Timing` response header — `db;dur=<ms>;desc="stmt=<n> tx=<m>", app;dur=<ms>` — only
 *    when enabled (`perf.serverTiming`: blank follows the mode, ON in development / OFF in
 *    production, `PERF_SERVER_TIMING=true|false` overrides — the `http.exposeOpenApi` idiom) AND only
 *    on responses to an AUTHENTICATED caller ([exposesTiming]). Statement counts are a side channel:
 *    `POST /login` answers `stmt=3` for an unknown email and `stmt=5` for a known one, the JWT
 *    challenge `stmt=1` for a revoked token and `0` for garbage — the account-enumeration oracle the
 *    uniform 401s exist to prevent. So the anonymous surface (login family, refresh, password reset,
 *    the 401 challenge, health probes, the SPA) NEVER carries the header, in any mode;
 *  - ONE INFO line `request.slow` on logger `ch.nokillswit.perf` per request at or over
 *    `perf.slowRequestMs` (`PERF_SLOW_REQUEST_MS`, default 1000), always on, server-side only: method,
 *    path WITHOUT the query string (query strings carry emails), status, wall/db milliseconds,
 *    statement and transaction counts, and the slowest statement's SQL template and duration. It never
 *    carries bind values.
 *
 * `app;dur` is the time from the Setup phase to the response being committed (everything the
 * server did, DB included); the log's `wallMs` runs to the end of the response write.
 *
 * Integration-API calls (per-API-key auth, not a JWT principal) get no header either — the same
 * rule, decided consistently: only a JWT-authenticated user caller sees it.
 */
private class RequestTimingConfig {
    var serverTiming: Boolean = false
    var slowRequestMs: Long = 1000
}

private val MetricsKey = AttributeKey<RequestDbMetrics>("RequestTiming.metrics")
private val StartNanosKey = AttributeKey<Long>("RequestTiming.startNanos")
private const val SERVER_TIMING = "Server-Timing"
private const val MAX_LOGGED_SQL = 300
private const val NANOS_PER_MILLI = 1_000_000.0

/** Defence in depth: even if a principal were ever attached on these, they never carry the header. */
private val ANONYMOUS_PREFIXES = listOf("/api/v1/login", "/api/v1/refresh", "/api/v1/password-reset")

private val perfLogger = LoggerFactory.getLogger("ch.nokillswit.perf")

/** True only for a response to a JWT-authenticated caller outside the auth endpoints. */
internal fun exposesTiming(call: ApplicationCall): Boolean =
    call.principal<JWTPrincipal>() != null && ANONYMOUS_PREFIXES.none { call.request.path().startsWith(it) }

private val RequestTimingPlugin = createApplicationPlugin("RequestTiming", ::RequestTimingConfig) {
    val serverTiming = pluginConfig.serverTiming
    val slowNanos = pluginConfig.slowRequestMs * 1_000_000

    // The CallLogging MDC pattern: one context element around everything downstream.
    application.intercept(ApplicationCallPipeline.Setup) {
        val metrics = RequestDbMetrics()
        call.attributes.put(MetricsKey, metrics)
        call.attributes.put(StartNanosKey, System.nanoTime())
        withContext(metrics) { proceed() }
    }

    if (serverTiming) {
        onCallRespond { call, _ ->
            val metrics = call.attributes.getOrNull(MetricsKey) ?: return@onCallRespond
            val started = call.attributes.getOrNull(StartNanosKey) ?: return@onCallRespond
            if (call.response.headers[SERVER_TIMING] == null && exposesTiming(call)) {
                val db = millis(metrics.dbNanos)
                val app = millis(System.nanoTime() - started)
                call.response.headers.append(
                    SERVER_TIMING,
                    "db;dur=$db;desc=\"stmt=${metrics.statements} tx=${metrics.transactions}\", app;dur=$app",
                )
            }
        }
    }

    on(ResponseSent) { call ->
        val metrics = call.attributes.getOrNull(MetricsKey) ?: return@on
        val started = call.attributes.getOrNull(StartNanosKey) ?: return@on
        val wall = System.nanoTime() - started
        if (wall >= slowNanos) {
            val slowest = metrics.slowest
            perfLogger.atInfo()
                .setMessage("request.slow")
                .addKeyValue("method", call.request.local.method.value)
                .addKeyValue("path", call.request.path())
                .addKeyValue("status", call.response.status()?.value)
                .addKeyValue("wallMs", millis(wall))
                .addKeyValue("dbMs", millis(metrics.dbNanos))
                .addKeyValue("stmt", metrics.statements)
                .addKeyValue("tx", metrics.transactions)
                .addKeyValue("slowestMs", slowest?.let { millis(it.nanos) })
                .addKeyValue("slowestSql", slowest?.sql?.take(MAX_LOGGED_SQL))
                .log()
        }
    }
}

private fun millis(nanos: Long): String = String.format(Locale.ROOT, "%.1f", nanos / NANOS_PER_MILLI)

fun Application.configureRequestTiming() {
    val config = environment.config
    val slowRequestMs = requireConfigInt(config, "perf.slowRequestMs", min = 1, max = 600_000)
    val explicit = config.propertyOrNull("perf.serverTiming")?.getString()?.takeIf { it.isNotBlank() }?.toBoolean()
    val serverTiming = explicit ?: developmentMode
    if (!developmentMode && explicit == true) {
        log.warn(
            "perf.serverTiming=true in production mode: authenticated responses carry the Server-Timing header " +
                "(DB time and statement counts). Anonymous responses never do. Switch it off after the measurement window.",
        )
    }
    // The interceptor is loaded by Exposed's ServiceLoader (META-INF/services). If it is not, every counter
    // would read 0 — say so once instead of emitting zeros. Compared by NAME: under the dev-mode reload class
    // loader the provider class and this module's copy are distinct Class objects (the element is not — core).
    val attached = ServiceLoader.load(GlobalSuspendStatementInterceptor::class.java)
        .any { it.javaClass.name == RequestDbMetricsInterceptor::class.java.name }
    if (!attached) log.warn("RequestDbMetricsInterceptor is not registered with Exposed: Server-Timing statement counts will read 0.")
    install(RequestTimingPlugin) {
        this.serverTiming = serverTiming
        this.slowRequestMs = slowRequestMs.toLong()
    }
}
