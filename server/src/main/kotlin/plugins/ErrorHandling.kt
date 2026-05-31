package ch.nokillswit.plugins

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.*
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.response.respond
import io.r2dbc.spi.R2dbcException
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.v1.exceptions.ExposedSQLException

@Serializable
data class ApiError(val error: String, val message: String)

private const val PG_UNIQUE_VIOLATION = "23505"

private fun Throwable.isUniqueViolation(): Boolean {
    var cur: Throwable? = this
    while (cur != null) {
        if (cur is R2dbcException && cur.sqlState == PG_UNIQUE_VIOLATION) return true
        cur = cur.cause
    }
    return false
}

private suspend fun ApplicationCall.respondConflict() {
    respond(HttpStatusCode.Conflict, ApiError("conflict", "Resource already exists"))
}

fun Application.configureErrorHandling() {
    install(StatusPages) {
        exception<ExposedSQLException> { call, cause ->
            if (cause.isUniqueViolation()) call.respondConflict() else throw cause
        }
        exception<R2dbcException> { call, cause ->
            if (cause.isUniqueViolation()) call.respondConflict() else throw cause
        }
    }
}
