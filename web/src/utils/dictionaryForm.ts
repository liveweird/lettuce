import type { TFunction } from "i18next";
import type { DictionaryEntry, DictionaryUpdateBody } from "../api/client";
import { saveErrorMessage } from "./saveError";

export const MAX_DICTIONARY_VALUE_LENGTH = 100;

/**
 * The ONE localization seam for bilingual dictionary values (V53): every display site picks
 * the viewer's language through this. `lang` is `i18n.resolvedLanguage` — anything that
 * isn't Polish falls back to English (the app's two-language model).
 */
export function pickDictionaryValue(
  entry: { valueEn: string; valuePl: string },
  lang: string | undefined,
): string {
  return lang === "pl" ? entry.valuePl : entry.valueEn;
}

// Draft rows carry a local `key` for React list identity (stable across reorders, unlike the
// index); rows loaded from the server also keep their `id`, which the PUT body preserves so the
// backend can tell renames from add/remove — new rows simply have no id.
export type DictionaryEntryDraft = {
  key: string;
  id?: number;
  valueEn: string;
  valuePl: string;
};

export type DictionaryFormValues = {
  entries: DictionaryEntryDraft[];
};

let keyCounter = 0;
export function newDraftKey(): string {
  keyCounter += 1;
  return `dict-draft-${keyCounter}`;
}

export function emptyEntryDraft(): DictionaryEntryDraft {
  return { key: newDraftKey(), valueEn: "", valuePl: "" };
}

/** The loaded dictionary -> editable form values. */
export function toFormValues(items: DictionaryEntry[]): DictionaryFormValues {
  return {
    entries: items.map((e) => ({ key: newDraftKey(), id: e.id, valueEn: e.valueEn, valuePl: e.valuePl })),
  };
}

/** Form values -> the PUT body (local keys stripped, values trimmed, ids preserved). */
export function toUpdateBody(values: DictionaryFormValues): DictionaryUpdateBody {
  return {
    items: values.entries.map((e) => ({ id: e.id, valueEn: e.valueEn.trim(), valuePl: e.valuePl.trim() })),
  };
}

/**
 * Mirrors the server's payload rules, PER LANGUAGE: non-blank, <=100 chars, and unique after
 * trimming within its own language (case-sensitive, like the two DB partial indexes — the
 * same string may be one row's English and another's Polish). The duplicate flag lands on
 * the LATER row so the first occurrence stays valid.
 */
export function dictionaryFormValidation(t: TFunction) {
  const rule = (field: "valueEn" | "valuePl") =>
    (v: string, values: DictionaryFormValues, path: string) => {
      const trimmed = v.trim();
      if (!trimmed) return t("dictionary.valueRequired");
      if (trimmed.length > MAX_DICTIONARY_VALUE_LENGTH) return t("dictionary.valueTooLong");
      const index = Number(path.split(".")[1]);
      const earlier = values.entries.slice(0, index);
      if (earlier.some((e) => e[field].trim() === trimmed)) return t("dictionary.valueDuplicate");
      return null;
    };
  return {
    entries: {
      valueEn: rule("valueEn"),
      valuePl: rule("valuePl"),
    },
  };
}

/** The shared mutation-error -> message mapping for dictionary saves. */
export function dictionarySaveErrorMessage(err: unknown, t: TFunction): string {
  return saveErrorMessage(err, t, {
    forbidden: "dictionary.error.permission",
    conflict: "dictionary.error.conflict",
    invalid: "dictionary.error.validation",
    failedStatus: "dictionary.error.saveFailedStatus",
    failed: "dictionary.error.saveFailed",
  });
}
