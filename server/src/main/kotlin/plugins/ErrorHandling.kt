package ch.nokillswit.plugins

import ch.nokillswit.authz.ForbiddenException
import ch.nokillswit.authz.UnauthorizedException
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
) {
    val problem = ProblemDetail(title = title, status = status.value, detail = detail)
    respond(
        TextContent(
            problemSerializer.encodeToString(ProblemDetail.serializer(), problem),
            ProblemJson.withCharset(Charsets.UTF_8),
            status,
        )
    )
}

private const val PG_UNIQUE_VIOLATION = "23505"

private fun Throwable.isUniqueViolation(): Boolean {
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
        exception<BadRequestException> { call, cause ->
            call.respondProblem(HttpStatusCode.BadRequest, cause.message ?: "Bad request")
        }
        exception<UnauthorizedException> { call, cause ->
            call.respondProblem(HttpStatusCode.Unauthorized, cause.message ?: "Unauthorized")
        }
        exception<ForbiddenException> { call, cause ->
            call.respondProblem(HttpStatusCode.Forbidden, cause.message ?: "Forbidden")
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
