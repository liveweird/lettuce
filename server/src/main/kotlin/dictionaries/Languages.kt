package ch.nokillswit.dictionaries

/**
 * The build-time supported-language set — mirrored by the SPA's `SUPPORTED_LANGUAGES` in
 * `web/src/i18n.ts` (a documented shared constant, like the enum-name whitelists). Adding a
 * language is a code change on both sides by design. [DEFAULT_LANGUAGE] is the one required
 * dictionary value per entry and the client-side display fallback.
 */
const val DEFAULT_LANGUAGE = "en"

val SUPPORTED_LANGUAGES: List<String> = listOf(DEFAULT_LANGUAGE, "pl")
