/**
 * THE localization seam for server-carried language->value maps (V60): dictionary entries,
 * the career triple, and the pulse rotating-question snapshots all arrive as a map with
 * `en` always present and other supported languages optional. Every display site resolves
 * the viewer's language through [pickLocalized] — never index a values map directly.
 */

/** Wire shape of a localized value map — structurally compatible with the generated
 *  `DictionaryValues` (`additionalProperties` + required `en`). */
export type LocalizedValues = { en: string } & Partial<Record<string, string>>;

/** The minimal entry shape shared by dictionary-backed references (career triple etc.). */
export type LocalizedEntry = { id: number; values: LocalizedValues };

/** Resolve the viewer's language with a blank-guarded English fallback. */
export function pickLocalized(values: LocalizedValues, lang: string | undefined): string {
  const v = lang ? values[lang] : undefined;
  return v && v.trim() !== "" ? v : values.en;
}
