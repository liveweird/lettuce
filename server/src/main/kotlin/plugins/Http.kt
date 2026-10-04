package ch.nokillswit.plugins

import io.ktor.server.application.*
import io.ktor.http.*
import io.ktor.http.content.*
import io.ktor.server.plugins.cachingheaders.*
import io.ktor.server.response.*
import io.ktor.server.plugins.cors.routing.*
import io.ktor.server.plugins.compression.*
import io.ktor.server.plugins.defaultheaders.*
import io.ktor.server.plugins.forwardedheaders.*
import io.ktor.server.plugins.mutableOriginConnectionPoint
import io.ktor.server.plugins.hsts.*
import io.ktor.server.plugins.httpsredirect.*
import io.ktor.server.routing.*
import io.ktor.server.plugins.swagger.*

fun Application.configureHttp() {
    // Response caching policy (v4.14.0) — three classes, no overlap:
    //   - SPA static files: owned by the static route in plugins/Routing.kt (hashed assets/ files are
    //     `immutable` for a year; index.html, the fallback and the other root files are `no-cache`,
    //     revalidated by ETag only — ConditionalHeaders is installed on THAT route alone, so no
    //     other response can ever pick up 304/412 semantics from a stray ETag/Last-Modified header).
    //   - the dynamic surface — /api/** and the integration GraphQL endpoint (/integration/**):
    //     `no-store` on every response (API-CACHE-002) — React Query owns client-side caching, and
    //     a stale authenticated read is worse than a refetch. A response that already carries a
    //     Cache-Control (StatusPages re-responds a 405/429 through this hook a second time) is left alone.
    //   - everything else (Swagger UI /openapi, probes, redirects): no Cache-Control from this plugin.
    install(CachingHeaders) {
        options { call, _ ->
            if (call.isApiSurfacePath() && !call.response.headers.contains(HttpHeaders.CacheControl)) {
                CachingOptions(CacheControl.NoStore(null))
            } else {
                null
            }
        }
    }
    // CORS is installed only when a cross-origin caller actually exists (an explicit allow-list
    // via CORS_ALLOWED_HOSTS). Production is single-origin (Ktor serves the SPA) and local dev
    // goes through the Vite proxy, so the default is: no CORS plugin, browsers enforce
    // same-origin, and no Access-Control-* headers are emitted.
    val corsHosts = environment.config.propertyOrNull("http.corsHosts")?.getString()
        ?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }
        .orEmpty()
    if (corsHosts.isNotEmpty()) {
        install(CORS) {
            allowMethod(HttpMethod.Options)
            allowMethod(HttpMethod.Put)
            allowMethod(HttpMethod.Delete)
            allowMethod(HttpMethod.Patch)
            allowHeader(HttpHeaders.Authorization)
            allowHeader(HttpHeaders.ContentType)
            corsHosts.forEach { allowHost(it, schemes = listOf("http", "https")) }
        }
    }
    // Behind a TLS-terminating reverse proxy / ingress, trust X-Forwarded-* so the client IP
    // (rate-limit buckets) and scheme (HTTPS redirect) are the real client's, not the proxy's.
    // Off by default: honoring these headers from direct clients would let them spoof both.
    if (environment.config.propertyOrNull("http.behindProxy")?.getString()?.toBoolean() == true) {
        val proxyHops = environment.config.propertyOrNull("http.proxyHops")?.getString()
            ?.takeIf { it.isNotBlank() }?.toInt() ?: 1
        require(proxyHops >= 1) { "http.proxyHops must be >= 1 (was $proxyHops)" }
        // A proxy may APPEND its own X-Forwarded-For LINE rather than merge into the one the
        // client sent (HAProxy's `option forwardedfor`), and XForwardedHeaders reads only the
        // FIRST line (`Headers.get`) — the client's, so the rate-limit key would be spoofable.
        // Fold every line ourselves and pick the trusted hop (v4.5.2, from the Flow handoff;
        // RawForwardedForLinesTest pins it against real Netty — ktor-client folds repeated
        // header() calls into one line, so testApplication cannot reproduce the wire shape).
        // What keeps XForwardedHeaders from overwriting the result is its EMPTY forHeaders list
        // below (it then never sets remoteHost) — not phase order: its CallSetup hook runs in
        // the same Setup phase as this interceptor. Never restore the default forHeaders.
        intercept(ApplicationCallPipeline.Setup) {
            resolveForwardedForOrigin(call, proxyHops)
        }
        install(XForwardedHeaders) {
            // Only the headers the proxy contract sets — and therefore overwrites. Ktor's defaults
            // also honour X-Forwarded-Server / X-Forwarded-Protocol / X-Forwarded-SSL /
            // Front-End-Https, which a proxy that sets just the canonical ones passes through
            // from the client untouched (v3.6.2, ProductionHttpTest).
            hostHeaders.clear()
            hostHeaders.add(HttpHeaders.XForwardedHost)
            protoHeaders.clear()
            protoHeaders.add(HttpHeaders.XForwardedProto)
            httpsFlagHeaders.clear()
            // Nothing reads the forwarded port (the HTTPS redirect targets sslPort, the scheme
            // comes from protoHeaders), and a client-supplied non-numeric value threw a
            // NumberFormatException inside the plugin — a 500 before any route ran (v4.5.2).
            portHeaders.clear()
            // X-Forwarded-For is resolved by resolveForwardedForOrigin above; left empty so this
            // plugin never overwrites that result with its own first-line-only read.
            forHeaders.clear()
        }
    }
    // Response compression only. The default Mode.All would also INFLATE `Content-Encoding: gzip`
    // request bodies with no decoded-size cap (a gzip bomb), after the body-size cap has already
    // counted only the compressed bytes. No client sends compressed request bodies, so a gzip body
    // is simply malformed JSON (the usual 400) and the cap in plugins/BodyLimit.kt counts wire bytes.
    install(Compression) {
        mode = CompressionConfig.Mode.CompressResponse
    }
    install(DefaultHeaders)
    if (!developmentMode) {
        // Behind ingress-nginx this header is OVERWRITTEN by the controller (configmap `hsts`,
        // `hsts-include-subdomains`, default on/on) — it matters pod-direct and behind proxies
        // that pass upstream headers through, so the policy lives there, not in a knob here.
        install(HSTS) {
            includeSubDomains = true
        }
        install(HttpsRedirect) {
            // The port to redirect to. By default 443, the default HTTPS port.
            sslPort = 443
            // 301 Moved Permanently, or 302 Found redirect.
            permanentRedirect = true
        }
    }
    // Swagger UI + the full spec are an API roadmap for anyone who can reach the host, so they
    // are served only in development mode — or when explicitly re-enabled for a trusted
    // environment via HTTP_EXPOSE_OPENAPI=true. (Bearer-token auth cannot protect a
    // browser-loaded UI: page loads carry no Authorization header.)
    val exposeOpenApi = environment.config.propertyOrNull("http.exposeOpenApi")?.getString()
        ?.takeIf { it.isNotBlank() }?.toBoolean()
        ?: developmentMode
    if (exposeOpenApi) {
        // swaggerUI serves both the UI page and the spec (GET /openapi/documentation.yaml).
        routing {
            swaggerUI(path = "openapi") {
            }
        }
    }
}

/**
 * The trust-from-the-end X-Forwarded-For selection XForwardedHeaders' useLastProxy() /
 * skipLastProxies() made (`http.proxyHops`: 1 trusts the value the last proxy wrote, N skips the
 * N-1 addresses trusted proxies appended after the client's — ForwardedHeadersTest), but over
 * EVERY X-Forwarded-For header line (`getAll`, joined in the order received — RFC 9110 §5.3), so
 * a line a trusted proxy appended is never shadowed by a client line of the same name. With fewer
 * values than hops it falls back to the last one (the value closest to us, never the client's).
 * Writes the call's mutable origin — what the rate limiter reads as
 * `call.request.origin.remoteHost`.
 */
private fun resolveForwardedForOrigin(call: ApplicationCall, proxyHops: Int) {
    val hops = call.request.headers.getAll(HttpHeaders.XForwardedFor)
        ?.flatMap { it.split(',') }
        ?.map { it.trim() }
        ?.filter { it.isNotEmpty() }
        ?.takeIf { it.isNotEmpty() }
        ?: return
    val chosen = hops.getOrNull(hops.size - proxyHops) ?: hops.last()
    val origin = call.mutableOriginConnectionPoint
    origin.remoteHost = chosen
    // Ktor's own resolution sets remoteAddress too, but only for a value that looks like an IP
    // (no letters, or an IPv6 literal, which always contains ':'); its helper is internal.
    if (chosen.contains(':') || chosen.none { it.isLetter() }) origin.remoteAddress = chosen
}
