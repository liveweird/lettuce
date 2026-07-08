package ch.nokillswit.infra.paging

import io.ktor.http.Parameters
import io.ktor.server.plugins.BadRequestException

// Small helpers for the repeated list-endpoint query-param parsing idioms, so every route stops
// hand-writing `params["x"]?.takeIf { it.isNotBlank() }` and the numeric variants.

/** The param's value, or null when absent or blank. */
fun Parameters.optionalString(name: String): String? = this[name]?.takeIf { it.isNotBlank() }

/** Parses a non-blank param as UInt; null when absent/blank, 400 when present but not a UInt. */
fun Parameters.optionalUInt(name: String): UInt? =
    optionalString(name)?.let { it.toUIntOrNull() ?: throw BadRequestException("Invalid $name: $it") }

/** Parses a non-blank param as Long; null when absent/blank, 400 when present but not a Long. */
fun Parameters.optionalLong(name: String): Long? =
    optionalString(name)?.let { it.toLongOrNull() ?: throw BadRequestException("Invalid $name: $it") }

/** Parses a non-blank param as a strict boolean; null when absent/blank, 400 unless exactly true/false. */
fun Parameters.optionalBoolean(name: String): Boolean? =
    optionalString(name)?.let {
        it.toBooleanStrictOrNull() ?: throw BadRequestException("$name must be true or false")
    }

/**
 * Parses a non-blank param as an enum constant (exact name match); null when absent/blank,
 * 400 (listing the allowed values) when present but not a constant of [E].
 */
inline fun <reified E : Enum<E>> Parameters.optionalEnum(name: String): E? =
    optionalString(name)?.let { raw ->
        enumValues<E>().firstOrNull { it.name == raw } ?: throw BadRequestException(
            "Unknown $name: $raw (allowed: ${enumValues<E>().joinToString { it.name }})",
        )
    }
