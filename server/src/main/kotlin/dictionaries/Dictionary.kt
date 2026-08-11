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
    SENIORITY_LEVEL("seniority-levels"),

    // The pulse rotating-question bank (Q6, v2.0.0): every entry must be a statement
    // answerable on the five-point agreement scale. Cycles snapshot the chosen entry's
    // text at schedule time, so edits here never rewrite what a past cycle asked.
    PULSE_ROTATING_QUESTION("pulse-rotating-questions");

    companion object {
        fun fromSlug(slug: String): Dictionary? = entries.firstOrNull { it.slug == slug }
    }
}

/** Every entry is bilingual (V53, v2.6.0): clients render the viewer's language. */
@Serializable
data class DictionaryEntry(val id: UInt, val valueEn: String, val valuePl: String)

@Serializable
data class DictionaryEntryList(val items: List<DictionaryEntry>)

/** PUT item: `id` present = update that active entry in place; absent = insert a new one. */
@Serializable
data class DictionaryEntryInput(val id: UInt? = null, val valueEn: String, val valuePl: String)

@Serializable
data class DictionaryUpdateRequest(val items: List<DictionaryEntryInput>)

// Column limit (dictionary_entries.value_en/_pl varchar(100)) enforced up-front: 400, not a DB 500.
const val MAX_DICTIONARY_VALUE_LENGTH = 100
const val MAX_DICTIONARY_ENTRIES = 200

/**
 * Single home of the payload rules — enforced by the route and re-checked by the service
 * (the validateAlert pattern). Values are compared TRIMMED (the service stores them trimmed);
 * uniqueness is case-sensitive and PER LANGUAGE (matching the two DB partial unique
 * indexes) — the same string may appear as one entry's English and another's Polish.
 */
fun validateDictionaryUpdate(request: DictionaryUpdateRequest) {
    if (request.items.size > MAX_DICTIONARY_ENTRIES) {
        throw BadRequestException("A dictionary may hold at most $MAX_DICTIONARY_ENTRIES entries")
    }
    for ((language, values) in mapOf(
        "English" to request.items.map { it.valueEn.trim() },
        "Polish" to request.items.map { it.valuePl.trim() },
    )) {
        if (values.any { it.isEmpty() }) {
            throw BadRequestException("Dictionary $language values must not be blank")
        }
        if (values.any { it.length > MAX_DICTIONARY_VALUE_LENGTH }) {
            throw BadRequestException(
                "Dictionary $language values must be at most $MAX_DICTIONARY_VALUE_LENGTH characters",
            )
        }
        if (values.size != values.toSet().size) {
            throw BadRequestException("Dictionary $language values must be unique")
        }
    }
}
