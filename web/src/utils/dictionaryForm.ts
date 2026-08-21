import type { TFunction } from "i18next";
import type { DictionaryEntry, DictionaryUpdateBody } from "../api/dictionaries";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "../i18n";
import { saveErrorMessage } from "./saveError";

export const MAX_DICTIONARY_VALUE_LENGTH = 100;

// Draft rows carry a local `key` for React list identity (stable across reorders, unlike the
// index); rows loaded from the server also keep their `id`, which the PUT body preserves so the
// backend can tell renames from add/remove — new rows simply have no id. Every supported
// language has a draft slot; "" means "no translation" (legal for every language but English).
export type DictionaryEntryDraft = {
  key: string;
  id?: number;
  values: Record<SupportedLanguage, string>;
};

export type DictionaryFormValues = {
  entries: DictionaryEntryDraft[];
};

let keyCounter = 0;
function newDraftKey(): string {
  keyCounter += 1;
  return `dict-draft-${keyCounter}`;
}

function blankValues(): Record<SupportedLanguage, string> {
  return Object.fromEntries(SUPPORTED_LANGUAGES.map((l) => [l, ""])) as Record<
    SupportedLanguage,
    string
  >;
}

export function emptyEntryDraft(): DictionaryEntryDraft {
  return { key: newDraftKey(), values: blankValues() };
}

/** The loaded dictionary -> editable form values (missing translations become empty inputs). */
export function toFormValues(items: DictionaryEntry[]): DictionaryFormValues {
  return {
    entries: items.map((e) => ({
      key: newDraftKey(),
      id: e.id,
      values: { ...blankValues(), ...e.values },
    })),
  };
}

/**
 * Form values -> the PUT body (local keys stripped, values trimmed, ids preserved).
 * Blank non-EN inputs are OMITTED from the wire map — the server's "omit the language to
 * clear its translation" contract; `en` is always sent.
 */
export function toUpdateBody(values: DictionaryFormValues): DictionaryUpdateBody {
  return {
    items: values.entries.map((e) => {
      const out: { en: string } & Record<string, string> = { en: e.values.en.trim() };
      for (const lang of SUPPORTED_LANGUAGES) {
        if (lang === "en") continue;
        const trimmed = e.values[lang].trim();
        if (trimmed) out[lang] = trimmed;
      }
      return { id: e.id, values: out };
    }),
  };
}

/**
 * Mirrors the server's payload rules, PER LANGUAGE: English required, other languages
 * optional; every filled value <=100 chars and unique after trimming within its own language
 * (case-sensitive — the same string may appear under two different languages). The duplicate
 * flag lands on the LATER row so the first occurrence stays valid.
 */
export function dictionaryFormValidation(t: TFunction) {
  const rule = (lang: SupportedLanguage) =>
    (v: string, values: DictionaryFormValues, path: string) => {
      const trimmed = v.trim();
      if (!trimmed) return lang === "en" ? t("dictionary.valueRequired") : null;
      if (trimmed.length > MAX_DICTIONARY_VALUE_LENGTH) return t("dictionary.valueTooLong", { max: MAX_DICTIONARY_VALUE_LENGTH });
      // path is `entries.<index>.values.<lang>` — [1] is the row index.
      const index = Number(path.split(".")[1]);
      const earlier = values.entries.slice(0, index);
      if (earlier.some((e) => e.values[lang].trim() === trimmed)) return t("dictionary.valueDuplicate");
      return null;
    };
  return {
    entries: {
      values: Object.fromEntries(SUPPORTED_LANGUAGES.map((l) => [l, rule(l)])) as Record<
        SupportedLanguage,
        ReturnType<typeof rule>
      >,
    },
  };
}

/** The shared mutation-error -> message mapping for dictionary saves. */
/** The languages named by per-entry value errors (`entries.<i>.values.<lang>` form paths) —
 *  the editor uses this both for the picker's "•" has-errors markers and for switching the
 *  visible translation column to a hidden offender on a failed save. */
export function errorLanguages(errorKeys: string[]): string[] {
  return errorKeys
    .map((key) => /^entries\.\d+\.values\.(\w+)$/.exec(key)?.[1])
    .filter((lang): lang is string => lang != null);
}

export function dictionarySaveErrorMessage(err: unknown, t: TFunction): string {
  return saveErrorMessage(err, t, {
    forbidden: "dictionary.error.permission",
    conflict: "dictionary.error.conflict",
    invalid: "dictionary.error.validation",
    failedStatus: "dictionary.error.saveFailedStatus",
    failed: "dictionary.error.saveFailed",
  });
}
