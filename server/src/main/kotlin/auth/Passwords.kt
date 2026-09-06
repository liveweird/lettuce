package ch.nokillswit.auth

import at.favre.lib.crypto.bcrypt.BCrypt
import java.security.SecureRandom

/**
 * bcrypt hashes at most 72 bytes including a null terminator, so a password may be at most
 * 71 UTF-8 bytes — longer input makes at.favre's strict strategy throw (a 500, and on login
 * an account-enumeration oracle if account outcomes diverge).
 * Enforced as 400 at the API boundary (see `validatePassword` in users/UserRoutes.kt) and
 * treated as never-matching in [verifyPassword].
 */
const val MAX_PASSWORD_BYTES = 71

internal const val DEFAULT_BCRYPT_COST = 12

// A fixed hash keeps unknown-account login checks on the same bcrypt work factor as passwords
// created by the application. Authentication still requires a real account record; knowing the
// dummy plaintext ("changeme") cannot turn an unknown email into a successful login.
internal const val DUMMY_LOGIN_PASSWORD_HASH =
    "\$2y\$12\$VD60LjzPo00G5MtaWE3h9OrqYUid.MVxc5D7oHsM8oErnD9wuIvya"

internal fun exceedsBcryptLimit(plain: String): Boolean =
    plain.toByteArray(Charsets.UTF_8).size > MAX_PASSWORD_BYTES

internal fun hashPassword(plain: String, cost: Int = DEFAULT_BCRYPT_COST): String =
    BCrypt.withDefaults().hashToString(cost, plain.toCharArray())

internal fun verifyPassword(plain: String, hash: String): Boolean =
    !exceedsBcryptLimit(plain) && BCrypt.verifyer().verify(plain.toCharArray(), hash).verified

/** Login-only account-existence hardening: eligible attempts execute exactly one verification,
 * against either the account hash or an equivalent-cost dummy hash. */
internal fun verifyLoginPassword(
    plain: String,
    accountPasswordHash: String?,
    verifier: (String, String) -> Boolean = ::verifyPassword,
): Boolean {
    val verified = verifier(plain, accountPasswordHash ?: DUMMY_LOGIN_PASSWORD_HASH)
    return accountPasswordHash != null && verified
}

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
