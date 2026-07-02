package ch.nokillswit.infra.db

import io.ktor.server.plugins.BadRequestException
import io.r2dbc.spi.R2dbcException
import org.jetbrains.exposed.v1.core.LikePattern
import org.jetbrains.exposed.v1.exceptions.ExposedSQLException

/**
 * Case-insensitive contains-match pattern with SQL LIKE metacharacters escaped. Shared by every
 * service's per-column substring filter — the escaping is correctness-sensitive and must not
 * drift between features. Callers lowercase the column side (`lowerCase() like …`).
 */
fun containsPattern(raw: String): LikePattern {
    val escaped = raw.lowercase()
        .replace("\\", "\\\\")
        .replace("%", "\\%")
        .replace("_", "\\_")
    return LikePattern("%$escaped%", escapeChar = '\\')
}

/**
 * Runs [block], translating low-level SQL failures (FK violations from client-supplied ids, on
 * either the JDBC or R2DBC path) into a 400 with [message]. Unique violations are not expected
 * through here — routes with unique columns rely on the global 23505→409 StatusPages mapping.
 */
suspend fun <T> requireValidReferences(message: String, block: suspend () -> T): T =
    try {
        block()
    } catch (e: ExposedSQLException) {
        throw BadRequestException(message, e)
    } catch (e: R2dbcException) {
        throw BadRequestException(message, e)
    }
