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

/**
 * The list endpoints' shared `includeIndirect` shape rule: the strict boolean is accepted only
 * while [view] is one of [allowed] (400 otherwise, naming the allowed views); absent = false.
 */
fun <T : Enum<T>> Parameters.optionalIncludeIndirect(view: T, allowed: List<T>): Boolean {
    val value = optionalBoolean("includeIndirect")
    if (value != null && view !in allowed) {
        val views = allowed.joinToString(" and ") { "view=${it.name.lowercase()}" }
        throw BadRequestException("includeIndirect is only supported for $views")
    }
    return value == true
}

/**
 * The list endpoints' shared view-scoped id param (the auditor `userId`, the 1:1 list's
 * `counterpartId`): required while [view] is [requiredView], rejected on any other view.
 * The 400s here deliberately run BEFORE any role gate at the call site — shape validation
 * first, then authorization (see `requireAuditListAccess` in authz/Guards.kt).
 */
fun <T : Enum<T>> Parameters.uintOnlyForView(name: String, view: T, requiredView: T): UInt? {
    val value = optionalUInt(name)
    val viewName = "view=${requiredView.name.lowercase()}"
    if (view == requiredView && value == null) {
        throw BadRequestException("$name is required for $viewName")
    }
    if (view != requiredView && value != null) {
        throw BadRequestException("$name is only supported for $viewName")
    }
    return value
}
