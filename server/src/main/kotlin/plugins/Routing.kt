package ch.nokillswit.plugins

import io.ktor.http.*
import io.ktor.http.content.*
import io.ktor.server.application.*
import io.ktor.server.application.hooks.ResponseBodyReadyForSend
import io.ktor.server.http.content.*
import io.ktor.server.plugins.conditionalheaders.ConditionalHeaders
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import java.io.File

/**
 * Makes the static route's conditional requests ETag-ONLY. Ktor's `LocalFileContent` always adds a
 * `LastModifiedVersion` from the file's mtime, and ConditionalHeaders answers `304` when ANY version
 * says "not modified" — it does not let `If-None-Match` take precedence over `If-Modified-Since`.
 * After a rollback to an older image (older, build-time mtimes) a browser holding the newer shell
 * sends `If-None-Match: <newer etag>` + `If-Modified-Since: <newer date>`; the date check would
 * answer `304` and pin the stale shell. Content-hash ETags are rollback-safe, build mtimes are not
 * (and a `Last-Modified` header would disclose the build time) — so only `EntityTagVersion`s survive.
 *
 * A request whose `If-None-Match`/`If-Match` cannot be parsed (`EntityTagVersion.parse` throws)
 * would otherwise surface as a 500 from inside ConditionalHeaders; RFC 9110 says to ignore a
 * malformed validator, so every version is dropped and the file is served normally.
 *
 * Must be installed BEFORE ConditionalHeaders on the same route (hooks run in install order).
 */
private val EtagOnlyValidators = createRouteScopedPlugin("EtagOnlyValidators") {
    on(ResponseBodyReadyForSend) { call, content ->
        val malformed = listOf(HttpHeaders.IfNoneMatch, HttpHeaders.IfMatch).any { name ->
            call.request.headers[name]?.let { runCatching { EntityTagVersion.parse(it) }.isFailure } == true
        }
        content.versions = if (malformed) emptyList() else content.versions.filterIsInstance<EntityTagVersion>()
    }
}

fun Application.configureRouting() {
    val staticDir = environment.config.propertyOrNull("web.staticDir")?.getString()?.takeIf { it.isNotBlank() }

    routing {
        if (staticDir != null) {
            // Serve the built React SPA: hashed assets plus a fallback to index.html
            // so React Router owns the non-/api URL space. When unset (local dev / tests),
            // the SPA is served by Vite and this module installs no routes.
            //
            // Caching (v4.14.0, API-CACHE-001): Vite writes every content-hashed chunk/stylesheet
            // under assets/, so those file names ARE their version — `immutable` for a year. Every
            // other file (index.html, which carries the version stamp and the per-deploy chunk names,
            // the SPA fallback, and the web/public files at the root) is `no-cache`: always
            // revalidated against a content-hash ETag (StrongSha256, stable across image rebuilds),
            // answered 304 by ConditionalHeaders. No Last-Modified is emitted (see EtagOnlyValidators).
            // ConditionalHeaders lives on this route only: nothing else (API responses included)
            // can acquire 304/412 semantics from an ETag or Last-Modified header it happens to write.
            // NEVER place an unhashed file under web/public/assets/ — it would be served immutable.
            val root = File(staticDir)
            val assets = File(root, "assets")
            fun File.isHashedAsset() = parentFile == assets
            route("/") {
                install(EtagOnlyValidators)
                install(ConditionalHeaders)
                staticFiles("/", root, index = "index.html") {
                    default("index.html")
                    etag(ETagProvider.StrongSha256)
                    // Ktor serves dotfiles by default (`/.env`, `/.git/…`); the SPA has none, so a stray
                    // one in the image must never be reachable — any dot segment answers a bodiless 403 (whether or not
                    // the file exists, so it is no existence oracle) instead of falling back.
                    exclude { file -> file.relativeToOrSelf(root).path.split(File.separatorChar).any { it.startsWith(".") } }
                    // Cache-Control is written raw here rather than through `cacheControl {}`: Ktor's
                    // CacheControl has no `immutable` directive, and the fallback is path-blind, so an
                    // unknown /api/ or /integration/ path also lands here — it must keep the single
                    // `no-store` the CachingHeaders rule in plugins/Http.kt gives every response of
                    // the dynamic surface (no extra `no-cache`). A hashed-looking path that does not
                    // exist falls back to index.html, whose file is not under assets/ — never immutable.
                    modify { file, call ->
                        when {
                            file.isHashedAsset() ->
                                call.response.headers.append(HttpHeaders.CacheControl, "public, max-age=31536000, immutable")
                            !call.isApiSurfacePath() ->
                                call.response.headers.append(HttpHeaders.CacheControl, "no-cache")
                        }
                    }
                }
            }
        }
    }
}
