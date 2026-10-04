package ch.nokillswit.plugins

import io.ktor.http.decodeURLPart
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.path

/**
 * The first path segment the way Ktor's router sees it: empty segments are skipped (so
 * `//api/v1/users` reaches the same handler as `/api/v1/users`) and the segment is percent-decoded
 * (`/%61pi/…`). `request.path()` alone is the RAW path, so a `startsWith("/api/")` test on it has a
 * hole exactly where routing is more lenient — every path-policy decision goes through this.
 */
private fun ApplicationCall.firstPathSegment(): String? =
    request.path().split('/').firstOrNull { it.isNotEmpty() }
        ?.let { runCatching { it.decodeURLPart() }.getOrDefault(it) }

/** The REST API: everything under `/api/` (`/api/v1/…`). */
internal fun ApplicationCall.isApiPath(): Boolean = firstPathSegment() == "api"

/**
 * Every dynamic, bearer-authenticated surface of the server: the REST API plus the integration
 * GraphQL endpoint and its schema (`/integration/…`). The response-caching policy (`no-store`,
 * plugins/Http.kt) covers all of it; the static SPA files are the only responses that may be cached.
 */
internal fun ApplicationCall.isApiSurfacePath(): Boolean =
    firstPathSegment().let { it == "api" || it == "integration" }
