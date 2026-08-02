package ch.nokillswit.dictionaries

import io.ktor.server.plugins.BadRequestException
import kotlinx.serialization.Serializable

/**
 * The closed set of global dictionaries. `slug` is the public URL segment
 * (`/api/v1/dictionaries/{slug}`); the enum name is the value stored in
 * `dictionary_entries.dictionary` (the application enum is the whitelist — no DB CHECK).
 */
enum class Dictionary(val slug: String) {
    CAREER_PATH("career-paths"),
    CAREER_SPECIALIZATION("career-specializations"),
    SENIORITY_LEVEL("seniority-levels");

    companion object {
        fun fromSlug(slug: String): Dictionary? = entries.firstOrNull { it.slug == slug }
    }
}

@Serializable
data class DictionaryEntry(val id: UInt, val value: String)

@Serializable
data class DictionaryEntryList(val items: List<DictionaryEntry>)

/** PUT item: `id` present = update that active entry in place; absent = insert a new one. */
@Serializable
data class DictionaryEntryInput(val id: UInt? = null, val value: String)

@Serializable
data class DictionaryUpdateRequest(val items: List<DictionaryEntryInput>)

// Column limit (dictionary_entries.value varchar(100)) enforced up-front: 400, not a DB 500.
const val MAX_DICTIONARY_VALUE_LENGTH = 100
const val MAX_DICTIONARY_ENTRIES = 200

/**
 * Single home of the payload rules — enforced by the route and re-checked by the service
 * (the validateAlert pattern). Values are compared TRIMMED (the service stores them trimmed);
 * uniqueness is case-sensitive, matching the DB partial unique index.
 */
fun validateDictionaryUpdate(request: DictionaryUpdateRequest) {
    if (request.items.size > MAX_DICTIONARY_ENTRIES) {
        throw BadRequestException("A dictionary may hold at most $MAX_DICTIONARY_ENTRIES entries")
    }
    val trimmed = request.items.map { it.value.trim() }
    if (trimmed.any { it.isEmpty() }) {
        throw BadRequestException("Dictionary values must not be blank")
    }
    if (trimmed.any { it.length > MAX_DICTIONARY_VALUE_LENGTH }) {
        throw BadRequestException("Dictionary values must be at most $MAX_DICTIONARY_VALUE_LENGTH characters")
    }
    if (trimmed.size != trimmed.toSet().size) {
        throw BadRequestException("Dictionary values must be unique")
    }
}
