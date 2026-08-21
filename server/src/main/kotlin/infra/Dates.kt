package ch.nokillswit.infra

import io.ktor.server.plugins.BadRequestException
import java.time.LocalDate
import java.time.format.DateTimeParseException

/**
 * The ONE strict business-date parser (2026-08 audit round — previously copied six times):
 * 400 unless [value] is a zero-padded 10-char ISO date. The length guard matters beyond
 * pedantry — every business date is stored in a lexicographically ordered VARCHAR(10)
 * column, so an expanded-year form ("+12026-01-05", which LocalDate.parse accepts) would
 * sort wrong. [label] leads the message ("Goal due date", "startDate", …) — route tests pin
 * the per-feature wording.
 */
fun parseIsoDateStrict(value: String, label: String): LocalDate = try {
    if (value.length != 10) throw DateTimeParseException("wrong length", value, 0)
    LocalDate.parse(value)
} catch (_: DateTimeParseException) {
    throw BadRequestException("$label must be an ISO date (YYYY-MM-DD)")
}
