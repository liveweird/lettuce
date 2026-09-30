package ch.nokillswit.infra.config

import io.ktor.server.config.ApplicationConfig

/**
 * Boot-time range validation for a numeric config value (checkup #36 C5, hoisted from
 * `auth/AuthRoutes.kt` in checkup #37 C2 so the pool bounds in `infra/db/Database.kt` share it):
 * a malformed or out-of-range setting is a config error, not a runtime concern —
 * `LOGIN_LOCKOUT_DURATION_SECONDS=0` would never lock while `login.lockout` still audits, and
 * `POSTGRES_POOL_MAX_SIZE=0` would leave the app with no connections. Refuses to start in EVERY
 * mode (the `security.encryption.key` malformed-key precedent in infra/crypto/Crypto.kt — this is
 * not gated by `developmentMode`). Both bounds are inclusive; a non-numeric override is rejected
 * the same way as an out-of-range one, with the key in the message.
 */
fun requireConfigInt(config: ApplicationConfig, key: String, min: Int, max: Int = Int.MAX_VALUE): Int {
    val raw = config.property(key).getString()
    val value = raw.toIntOrNull()
    if (value == null || value < min || value > max) {
        error("Config \"$key\" must be an integer ${bounds(min.toLong(), max.toLong(), Int.MAX_VALUE.toLong())} (was \"$raw\")")
    }
    return value
}

/** The [requireConfigInt] sibling for the `Long`-typed duration/interval settings. */
fun requireConfigLong(config: ApplicationConfig, key: String, min: Long, max: Long = Long.MAX_VALUE): Long {
    val raw = config.property(key).getString()
    val value = raw.toLongOrNull()
    if (value == null || value < min || value > max) {
        error("Config \"$key\" must be an integer ${bounds(min, max, Long.MAX_VALUE)} (was \"$raw\")")
    }
    return value
}

/**
 * The [requireConfigInt] sibling for a setting whose BLANK value means "use the default" (the
 * mode-following rate limits): null when missing or blank, otherwise range-checked the same way.
 */
fun optionalConfigInt(config: ApplicationConfig, key: String, min: Int, max: Int): Int? {
    val raw = config.propertyOrNull(key)?.getString()?.takeIf { it.isNotBlank() } ?: return null
    val value = raw.toIntOrNull()
    if (value == null || value < min || value > max) {
        error("Config \"$key\" must be an integer ${bounds(min.toLong(), max.toLong(), Int.MAX_VALUE.toLong())} (was \"$raw\")")
    }
    return value
}

/**
 * The ceiling on every seconds-valued security window and token lifetime (the login lockout, the
 * password-reset interval, the MFA code TTL, the refresh-token TTL): 30 days. Each is multiplied
 * into milliseconds, so an unbounded value near Long.MAX_VALUE overflowed — negative silently
 * disabled a window, positive made a token effectively never expire (v4.5.2, the Flow handoff and
 * its review). Nothing legitimate is anywhere near it.
 */
const val MAX_DURATION_SECONDS = 30L * 24 * 3600

private fun bounds(min: Long, max: Long, unbounded: Long): String =
    if (max == unbounded) ">= $min" else "between $min and $max"
