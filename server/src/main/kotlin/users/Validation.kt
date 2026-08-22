package ch.nokillswit.users

import ch.nokillswit.dictionaries.SUPPORTED_LANGUAGES
import io.ktor.server.plugins.BadRequestException

/** Column limits (see Users table / migrations) enforced up-front so oversized or blank
 *  payloads are a clean 400 instead of a DB-level 500. */
internal const val MAX_NAME_LENGTH = 50
internal const val MAX_EMAIL_LENGTH = 254
internal const val MAX_UNIQUE_ID_LENGTH = 50

/** Canonical email identity (v2.35.0, MT-001): trimmed + case-folded. Applied at EVERY entry
 *  point — create, update, import, login, password reset, and the lookup itself — so one
 *  mailbox is one account (`ADMIN@x` no longer creates a second account beside `admin@x`, and
 *  a padded/case-variant login matches; the login/reset throttles were already folding their
 *  keys this way). A pure fold that never throws: login must stay a uniform 401 on garbage. */
internal fun canonicalEmail(raw: String): String = raw.trim().lowercase()

/** The email acceptance rule, shared by user create/update, the CSV import, and the
 *  password-reset endpoint — callers pass the [canonicalEmail]-folded value. Deliberately
 *  loose (presence of '@' + length) — real validation is delivery. */
internal fun validateEmail(email: String) {
    if (email.isBlank()) throw BadRequestException("Email must not be blank")
    if (email.length > MAX_EMAIL_LENGTH) throw BadRequestException("Email must be at most $MAX_EMAIL_LENGTH characters")
    if ('@' !in email) throw BadRequestException("Email must contain '@'")
    if (email.any { it.isISOControl() }) throw BadRequestException("Email must not contain control characters")
}

internal fun validateNameAndEmail(name: String, email: String) {
    if (name.isBlank()) throw BadRequestException("Name must not be blank")
    if (name.length > MAX_NAME_LENGTH) throw BadRequestException("Name must be at most $MAX_NAME_LENGTH characters")
    validateEmail(email)
}

/** The user language (V61) when provided: must be a supported code. Null = default. */
internal fun validateLanguage(language: String?) {
    if (language != null && language !in SUPPORTED_LANGUAGES) {
        throw BadRequestException("Unsupported language (supported: ${SUPPORTED_LANGUAGES.joinToString()})")
    }
}

/** The unique id (V59) when provided: non-blank, within the column cap. Null = not set /
 *  leave unchanged — never validated (clearing is inexpressible, see the assign guard). */
internal fun validateUniqueId(uniqueId: String?) {
    if (uniqueId == null) return
    if (uniqueId.isBlank()) throw BadRequestException("Unique id must not be blank")
    if (uniqueId.length > MAX_UNIQUE_ID_LENGTH) {
        throw BadRequestException("Unique id must be at most $MAX_UNIQUE_ID_LENGTH characters")
    }
}
