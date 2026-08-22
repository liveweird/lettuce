package ch.nokillswit.users

import ch.nokillswit.infra.validation.sanitizeSingleLine
import io.ktor.server.plugins.BadRequestException

/**
 * The pure half of the mass user import (side-effect-free, directly unit-tested in
 * UserImportParserTest): raw CSV text → per-line outcomes. The route (UserRoutes.kt) owns
 * everything effectful — persistence, email, audit.
 */
internal sealed interface ImportLine {
    /** A syntactically valid `name,email` row, ready to be created. */
    data class Parsed(val line: Int, val name: String, val email: String) : ImportLine

    /** A line that failed parsing or field validation — already a reportable result row. */
    data class Invalid(val row: UserImportRow) : ImportLine
}

/**
 * Parses the uploaded CSV: 1-based line numbers; blank lines and an optional literal
 * `name,email` header (as the first non-blank line) are skipped; each remaining line is
 * split on its LAST comma (emails cannot contain commas, names may) and validated with the
 * same rules as single-user creation.
 */
internal fun parseImportRows(csv: String): List<ImportLine> {
    val candidates = csv.lines()
        .mapIndexedNotNull { idx, raw -> (idx + 1 to raw.trim()).takeIf { it.second.isNotEmpty() } }
        .let { nonBlank ->
            if (nonBlank.firstOrNull()?.second.equals("name,email", ignoreCase = true)) {
                nonBlank.drop(1)
            } else nonBlank
        }
    return candidates.map { (line, text) ->
        val comma = text.lastIndexOf(',')
        if (comma < 0) {
            return@map ImportLine.Invalid(
                UserImportRow(line, status = UserImportStatus.PARSE_ERROR, message = "Expected 'name,email'"),
            )
        }
        val name = text.substring(0, comma).trim()
        val email = text.substring(comma + 1).trim()
        try {
            // Canonical identity (v2.35.0): the same fold/sanitation as the create route, so
            // an imported `ADMIN@x` row is the same account as `admin@x` (MT-001/MT-002).
            val cleanName = sanitizeSingleLine(name, "Name")
            val cleanEmail = canonicalEmail(email)
            validateNameAndEmail(cleanName, cleanEmail)
            ImportLine.Parsed(line, cleanName, cleanEmail)
        } catch (e: BadRequestException) {
            ImportLine.Invalid(UserImportRow(line, name, email, UserImportStatus.PARSE_ERROR, e.message))
        }
    }
}
