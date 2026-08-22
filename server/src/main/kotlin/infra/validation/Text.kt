package ch.nokillswit.infra.validation

import io.ktor.server.plugins.BadRequestException

/**
 * Single-line identity fields (user/team/template names, the unique id): surrounding
 * whitespace is stripped before validation and persistence, and ISO control characters
 * (newlines, tabs, the C0/C1 ranges) are rejected up-front — they only ever produce visually
 * duplicate identities, broken table/badge/email rendering, or un-typeable values (2026-08-22
 * monkey-test round, MT-002). NUL alone was already caught DB-side (the 22021 mapping); this
 * closes the rest of the range at the validation layer. Multi-line content fields (feedback,
 * notes, descriptions, template content) deliberately keep their newlines and never go
 * through this.
 */
fun sanitizeSingleLine(value: String, field: String): String {
    val trimmed = value.trim()
    if (trimmed.any { it.isISOControl() }) {
        throw BadRequestException("$field must not contain control characters")
    }
    return trimmed
}
