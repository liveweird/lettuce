package ch.nokillswit.plugins

import ch.nokillswit.audit.audit
import ch.nokillswit.authz.ConflictException
import ch.nokillswit.authz.ForbiddenException
import ch.nokillswit.authz.TooManyRequestsException
import ch.nokillswit.authz.UnauthorizedException
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.principal
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.withCharset
import io.ktor.server.application.*
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.response.respond
import io.r2dbc.spi.R2dbcException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.jetbrains.exposed.v1.exceptions.ExposedSQLException

/**
 * RFC 7807 problem detail. Serialized as `application/problem+json`.
 *
 * `type` defaults to `about:blank`, in which case `title` is the standard reason phrase for
 * `status` (per the RFC). `detail` is the occurrence-specific message.
 */
@Serializable
data class ProblemDetail(
    val type: String = "about:blank",
    val title: String,
    val status: Int,
    val detail: String? = null,
    val instance: String? = null,
)

/** RFC 7807 media type for error bodies. */
val ProblemJson: ContentType = ContentType("application", "problem+json")

private val problemSerializer = Json { encodeDefaults = true; explicitNulls = false }

/**
 * Respond with an RFC 7807 `application/problem+json` body. Goes through [TextContent] explicitly
 * so ContentNegotiation does not relabel it as `application/json`. Usable from anywhere — including
 * the JWT `challenge`, which runs outside [StatusPages].
 */
suspend fun ApplicationCall.respondProblem(
    status: HttpStatusCode,
    detail: String? = null,
    title: String = status.description,
    instance: String? = null,
) {
    val problem = ProblemDetail(title = title, status = status.value, detail = detail, instance = instance)
    respond(
        TextContent(
            problemSerializer.encodeToString(ProblemDetail.serializer(), problem),
            ProblemJson.withCharset(Charsets.UTF_8),
            status,
        )
    )
}

private const val PG_UNIQUE_VIOLATION = "23505"

// Internal (not private): the user-import loop classifies per-row duplicates with it.
internal fun Throwable.isUniqueViolation(): Boolean {
    var cur: Throwable? = this
    while (cur != null) {
        if (cur is R2dbcException && cur.sqlState == PG_UNIQUE_VIOLATION) return true
        cur = cur.cause
    }
    return false
}

private suspend fun ApplicationCall.respondConflict() =
    respondProblem(HttpStatusCode.Conflict, "Resource already exists")

private suspend fun ApplicationCall.respondInternalError(cause: Throwable) {
    application.log.error("Unhandled exception while processing ${request.local.method.value} ${request.local.uri}", cause)
    respondProblem(HttpStatusCode.InternalServerError, "An unexpected error occurred")
}

fun Application.configureErrorHandling() {
    install(StatusPages) {
        // The per-IP RateLimit plugin rejects with a bodiless 429; give it the same RFC 7807
        // body every other error carries. NOTE: this status handler intercepts EVERY 429 that
        // StatusPages itself didn't produce — so caller-specific 429s (the login lockout) must
        // go through TooManyRequestsException below (handled calls are marked and skipped),
        // never a direct respondProblem, or their specific detail would be replaced.
        status(HttpStatusCode.TooManyRequests) { call, status ->
            call.respondProblem(status, "Rate limit exceeded — retry later")
        }
        exception<TooManyRequestsException> { call, cause ->
            call.respondProblem(HttpStatusCode.TooManyRequests, cause.message ?: "Too many requests")
        }
        exception<BadRequestException> { call, cause ->
            call.respondProblem(HttpStatusCode.BadRequest, cause.message ?: "Bad request")
        }
        exception<UnauthorizedException> { call, cause ->
            call.respondProblem(HttpStatusCode.Unauthorized, cause.message ?: "Unauthorized")
        }
        exception<ForbiddenException> { call, cause ->
            // Denials are part of the security audit trail: who tried what they may not do.
            audit(
                "authz.denied",
                "method" to call.request.local.method.value,
                "path" to call.request.local.uri,
                "userId" to call.principal<JWTPrincipal>()?.payload?.getClaim("userId")?.asLong(),
                "detail" to cause.message,
            )
            call.respondProblem(HttpStatusCode.Forbidden, cause.message ?: "Forbidden")
        }
        exception<ConflictException> { call, cause ->
            call.respondProblem(HttpStatusCode.Conflict, cause.message ?: "Conflict", instance = cause.instance)
        }
        // Non-unique DB failures fall through to a 500 problem (logged) instead of rethrowing,
        // which would escape StatusPages and yield a bodiless default 500.
        exception<ExposedSQLException> { call, cause ->
            if (cause.isUniqueViolation()) call.respondConflict() else call.respondInternalError(cause)
        }
        exception<R2dbcException> { call, cause ->
            if (cause.isUniqueViolation()) call.respondConflict() else call.respondInternalError(cause)
        }
        exception<Throwable> { call, cause ->
            call.respondInternalError(cause)
        }
    }
}
