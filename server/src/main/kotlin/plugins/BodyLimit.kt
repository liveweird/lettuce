package ch.nokillswit.plugins

import ch.nokillswit.infra.config.requireConfigLong
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.install
import io.ktor.server.plugins.bodylimit.RequestBodyLimit
import io.ktor.util.AttributeKey

private const val MIN_BODY_LIMIT_BYTES = 1024L // login/refresh are ~100 B: the smallest body class still fits
private const val MAX_BODY_LIMIT_BYTES = 1L shl 30 // 1 GiB: a cap must still be a cap

internal val RequestBodyLimitKey = AttributeKey<Long>("RequestBodyLimitBytes")

/**
 * The request-body size cap (v4.14.1): every request body is bounded BEFORE it is read in full.
 * Ktor's `RequestBodyLimit` plugin has two hooks, both driven by the one configured limit:
 *  - the Content-Length precheck runs in the application pipeline's `Validators` phase — BEFORE
 *    routing, authentication and the rate-limit buckets — and throws `PayloadTooLargeException`
 *    when the declared length is over the cap, so nothing is read;
 *  - at `call.receive` the request channel is wrapped in a counting copy that closes the stream
 *    with the same exception once the running total passes the cap, which bounds chunked and
 *    undeclared-length bodies without buffering them (ContentNegotiation then re-wraps it in a
 *    `BadRequestException` — both shapes become the 413 in plugins/ErrorHandling.kt).
 * Compressed request bodies are never inflated (plugins/Http.kt), so the cap counts wire bytes.
 * Config + rationale: `http.maxBodyBytes` in application.yaml and "Request body size cap" in
 * `.claude/docs/security-details.md`.
 */
fun Application.configureBodyLimit() {
    val limit = requireConfigLong(environment.config, "http.maxBodyBytes", MIN_BODY_LIMIT_BYTES, MAX_BODY_LIMIT_BYTES)
    attributes.put(RequestBodyLimitKey, limit)
    install(RequestBodyLimit) { bodyLimit { limit } }
}

/** The cap that applied to this call — for the 413 problem detail (plugins/ErrorHandling.kt). */
internal fun ApplicationCall.requestBodyLimit(): Long? = application.attributes.getOrNull(RequestBodyLimitKey)
