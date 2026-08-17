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

/**
 * Every entry carries a language->value map (V60, v2.20.0): [DEFAULT_LANGUAGE] is always
 * present, other supported languages appear only when a translation exists — clients render
 * the viewer's language and fall back to English.
 */
@Serializable
data class DictionaryEntry(val id: UInt, val values: Map<String, String>)

@Serializable
data class DictionaryEntryList(val items: List<DictionaryEntry>)

/** PUT item: `id` present = update that active entry in place; absent = insert a new one. */
@Serializable
data class DictionaryEntryInput(val id: UInt? = null, val values: Map<String, String>)

@Serializable
data class DictionaryUpdateRequest(val items: List<DictionaryEntryInput>)

// Column limit (dictionary_entries.value_en varchar(100); translation map values are
// validation-capped to match) enforced up-front: 400, not a DB 500.
const val MAX_DICTIONARY_VALUE_LENGTH = 100
const val MAX_DICTIONARY_ENTRIES = 200

/**
 * Single home of the payload rules — enforced by the route and re-checked by the service
 * (the validateAlert pattern). Values are compared TRIMMED (the service stores them trimmed);
 * uniqueness is case-sensitive and PER LANGUAGE — the same string may appear under two
 * different languages. Only [DEFAULT_LANGUAGE] is required; a language whose translation
 * should be cleared is simply omitted from the map (a PRESENT blank value is a 400, so
 * "empty means clear" typos don't silently drop data). Because the PUT is a whole-document
 * replace, payload-level per-language uniqueness IS post-save active-set uniqueness; only
 * EN additionally keeps its partial unique index as the DB backstop.
 */
fun validateDictionaryUpdate(request: DictionaryUpdateRequest) {
    if (request.items.size > MAX_DICTIONARY_ENTRIES) {
        throw BadRequestException("A dictionary may hold at most $MAX_DICTIONARY_ENTRIES entries")
    }
    val unknownLanguages = request.items.flatMap { it.values.keys }.toSet() - SUPPORTED_LANGUAGES.toSet()
    if (unknownLanguages.isNotEmpty()) {
        throw BadRequestException(
            "Unsupported language code(s): ${unknownLanguages.sorted().joinToString()}. " +
                "Supported: ${SUPPORTED_LANGUAGES.joinToString()}",
        )
    }
    if (request.items.any { it.values[DEFAULT_LANGUAGE].isNullOrBlank() }) {
        throw BadRequestException("Every dictionary entry must provide an '$DEFAULT_LANGUAGE' value")
    }
    for (language in SUPPORTED_LANGUAGES) {
        val values = request.items.mapNotNull { it.values[language]?.trim() }
        if (values.any { it.isEmpty() }) {
            throw BadRequestException(
                "Dictionary '$language' values must not be blank — omit the language to clear its translation",
            )
        }
        if (values.any { it.length > MAX_DICTIONARY_VALUE_LENGTH }) {
            throw BadRequestException(
                "Dictionary '$language' values must be at most $MAX_DICTIONARY_VALUE_LENGTH characters",
            )
        }
        if (values.size != values.toSet().size) {
            throw BadRequestException("Dictionary '$language' values must be unique")
        }
    }
}
