package ch.nokillswit.auth

import at.favre.lib.crypto.bcrypt.BCrypt
import java.security.SecureRandom

/**
 * bcrypt hashes at most 72 bytes including a null terminator, so a password may be at most
 * 71 UTF-8 bytes — longer input makes at.favre's strict strategy throw (a 500, and on login
 * an account-enumeration oracle: unknown emails short-circuit to 401 before hashing).
 * Enforced as 400 at the API boundary (see `validatePassword` in users/UserRoutes.kt) and
 * treated as never-matching in [verifyPassword].
 */
const val MAX_PASSWORD_BYTES = 71

internal fun exceedsBcryptLimit(plain: String): Boolean =
    plain.toByteArray(Charsets.UTF_8).size > MAX_PASSWORD_BYTES

internal fun hashPassword(plain: String, cost: Int = 12): String =
    BCrypt.withDefaults().hashToString(cost, plain.toCharArray())

internal fun verifyPassword(plain: String, hash: String): Boolean =
    !exceedsBcryptLimit(plain) && BCrypt.verifyer().verify(plain.toCharArray(), hash).verified

// Same 64-char alphabet as the SPA's client-side generator (web/src/utils/password.ts):
// 6 bits of entropy per character, 96 bits at the default length.
private const val PASSWORD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
private val secureRandom = SecureRandom()

/** Server-side counterpart of the SPA's generatePassword — used by the password-reset flow. */
internal fun generatePassword(length: Int = 16): String =
    buildString(length) {
        repeat(length) { append(PASSWORD_ALPHABET[secureRandom.nextInt(PASSWORD_ALPHABET.length)]) }
    }

/** The 6-digit email-MFA code (leading zeros kept) — guess-resistance comes from the challenge
 *  attempt cap, not the code length (see auth/MfaChallenges.kt). */
internal fun generateMfaCode(): String = "%06d".format(secureRandom.nextInt(1_000_000))

/** Recognizable prefix of every integration API key — lets operators identify leaked
 *  credentials at a glance and lets the bearer provider fail fast on foreign tokens. */
const val API_KEY_PREFIX = "lettuce_int_"

/** Integration API key (v3.0.0): prefix + 43 alphabet chars = ~258 bits of entropy.
 *  Shown once at creation; only the SHA-256 digest is stored (see integration/). */
internal fun generateApiKey(): String = API_KEY_PREFIX + generatePassword(length = 43)
