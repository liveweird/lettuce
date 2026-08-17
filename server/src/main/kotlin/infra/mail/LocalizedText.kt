package ch.nokillswit.infra.mail

/**
 * A server-composed text in every supported language (v2.21.0 — the successor of the
 * bilingual EN+PL email bodies). The constructor arity IS the add-a-language gate: adding a
 * language to SUPPORTED_LANGUAGES means adding a parameter here, which turns every email
 * text in the codebase into a compile error until translated — the server-side sibling of
 * the SPA's locale-parity gate. [of] resolves the recipient's language with the English
 * fallback for anything unknown (LocalizedEmailTest pins that no supported language falls
 * into the fallback).
 */
internal data class LocalizedText(val en: String, val pl: String) {
    /** The recipient's text, English fallback for anything unknown. */
    fun of(language: String): String = when (language) {
        "pl" -> pl
        else -> en
    }
}
