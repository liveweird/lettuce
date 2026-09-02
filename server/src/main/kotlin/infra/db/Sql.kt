package ch.nokillswit.infra.db

import ch.nokillswit.plugins.isForeignKeyViolation
import io.ktor.server.plugins.BadRequestException
import io.r2dbc.spi.R2dbcException
import org.jetbrains.exposed.v1.core.CustomFunction
import org.jetbrains.exposed.v1.core.Expression
import org.jetbrains.exposed.v1.core.LikeEscapeOp
import org.jetbrains.exposed.v1.core.LikePattern
import org.jetbrains.exposed.v1.core.LowerCase
import org.jetbrains.exposed.v1.core.Op
import org.jetbrains.exposed.v1.core.TextColumnType
import org.jetbrains.exposed.v1.core.stringParam
import org.jetbrains.exposed.v1.exceptions.ExposedSQLException

/**
 * Case- and diacritics-insensitive contains-match: renders
 * `LOWER(public.unaccent(col)) LIKE LOWER(public.unaccent(?)) ESCAPE '\'`, so "zolw" matches
 * "Żółw" and vice versa. Both sides fold through PG's unaccent (extension enabled in V43) — the
 * rules can't drift between query and stored text (ł→l, ß→ss, æ→ae, …), and unaccent never
 * touches ASCII `% _ \`, so [containsPattern]'s escaping survives the folding. unaccent runs
 * BEFORE LOWER on purpose: unaccent maps to same-case ASCII base letters, which LOWER folds
 * correctly under any DB locale — in a C-locale database (the postgres:18-alpine default),
 * `LOWER('Ż')` alone would leave the letter uppercase and uppercase-diacritic input would
 * silently stop matching. Every per-column substring filter MUST use this — never hand-roll
 * `lowerCase() like`.
 */
fun Expression<out String?>.containsNormalized(raw: String): Op<Boolean> {
    val pattern = containsPattern(raw)
    return LikeEscapeOp(
        LowerCase(unaccent(this)),
        LowerCase(unaccent(stringParam(pattern.pattern))),
        like = true,
        escapeChar = pattern.escapeChar,
    )
}

// Schema-qualified so resolution never depends on search_path. Accepts nullable string
// expressions too (users.unique_id): a NULL value never LIKE-matches, which is exactly
// what a substring filter over an optional column should do.
private fun unaccent(expr: Expression<*>): CustomFunction<String> =
    CustomFunction("public.unaccent", TextColumnType(), expr)

/**
 * Case-insensitive contains-match pattern with SQL LIKE metacharacters escaped — the escaping
 * is correctness-sensitive and must not drift. Used only via [containsNormalized]; internal so
 * no filter site can bypass the diacritics folding.
 */
internal fun containsPattern(raw: String): LikePattern {
    val escaped = raw.lowercase()
        .replace("\\", "\\\\")
        .replace("%", "\\%")
        .replace("_", "\\_")
    return LikePattern("%$escaped%", escapeChar = '\\')
}

/**
 * Runs [block], translating a foreign-key violation (23503 — a client-supplied id that
 * references no row, on either the JDBC or R2DBC path) into a 400 with [message]. Every other
 * SQL failure is RETHROWN: unique violations (23505) keep the global StatusPages 23505→409
 * mapping — a wrapped block whose table carries unique indexes (succession nominations,
 * performance reviews) must answer 409 on the concurrent-duplicate race (checkup-29 fix) — and
 * anything else (a CHECK violation, say) is a server bug that must surface as a 500, never as
 * a misleading reference 400 (checkup-31 fix).
 */
suspend fun <T> requireValidReferences(message: String, block: suspend () -> T): T =
    try {
        block()
    } catch (e: ExposedSQLException) {
        // Only a foreign-key violation (23503) is the client's bad id; a unique violation stays
        // the 409 above, and anything else (a CHECK violation, say) is a server bug → 500,
        // never a misleading "referenced X does not exist" (checkup #31).
        if (!e.isForeignKeyViolation()) throw e
        throw BadRequestException(message, e)
    } catch (e: R2dbcException) {
        if (!e.isForeignKeyViolation()) throw e
        throw BadRequestException(message, e)
    }

/**
 * Post-commit read-back guard: the create/transition already committed (Location set, events
 * persisted), so a missing re-read is a server-side anomaly (500 via [error]), never a client
 * 404. Reads `X.read(id).orVanished("Goal", id)`; transitions pass a phase like "after opening".
 */
fun <T> T?.orVanished(resource: String, id: Any, phase: String = "between create and re-read"): T =
    this ?: error("$resource $id vanished $phase")
