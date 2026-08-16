package ch.nokillswit.users

import io.ktor.server.plugins.BadRequestException

/** Column limits (see Users table / migrations) enforced up-front so oversized or blank
 *  payloads are a clean 400 instead of a DB-level 500. */
internal const val MAX_NAME_LENGTH = 50
internal const val MAX_EMAIL_LENGTH = 254
internal const val MAX_UNIQUE_ID_LENGTH = 50

/** The email acceptance rule, shared by user create/update, the CSV import, and the
 *  password-reset endpoint. Deliberately loose (presence of '@' + length) — real validation
 *  is delivery. */
internal fun validateEmail(email: String) {
    if (email.isBlank()) throw BadRequestException("Email must not be blank")
    if (email.length > MAX_EMAIL_LENGTH) throw BadRequestException("Email must be at most $MAX_EMAIL_LENGTH characters")
    if ('@' !in email) throw BadRequestException("Email must contain '@'")
}

internal fun validateNameAndEmail(name: String, email: String) {
    if (name.isBlank()) throw BadRequestException("Name must not be blank")
    if (name.length > MAX_NAME_LENGTH) throw BadRequestException("Name must be at most $MAX_NAME_LENGTH characters")
    validateEmail(email)
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
