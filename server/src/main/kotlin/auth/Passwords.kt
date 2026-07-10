package ch.nokillswit.auth

import at.favre.lib.crypto.bcrypt.BCrypt
import java.security.SecureRandom

internal fun hashPassword(plain: String, cost: Int = 12): String =
    BCrypt.withDefaults().hashToString(cost, plain.toCharArray())

internal fun verifyPassword(plain: String, hash: String): Boolean =
    BCrypt.verifyer().verify(plain.toCharArray(), hash).verified

// Same 64-char alphabet as the SPA's client-side generator (web/src/utils/password.ts):
// 6 bits of entropy per character, 96 bits at the default length.
private const val PASSWORD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
private val secureRandom = SecureRandom()

/** Server-side counterpart of the SPA's generatePassword — used by the password-reset flow. */
internal fun generatePassword(length: Int = 16): String =
    buildString(length) {
        repeat(length) { append(PASSWORD_ALPHABET[secureRandom.nextInt(PASSWORD_ALPHABET.length)]) }
    }
