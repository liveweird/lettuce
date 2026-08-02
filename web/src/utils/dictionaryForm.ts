import type { TFunction } from "i18next";
import type { DictionaryEntry, DictionaryUpdateBody } from "../api/client";
import { saveErrorMessage } from "./saveError";

export const MAX_DICTIONARY_VALUE_LENGTH = 100;

// Draft rows carry a local `key` for React list identity (stable across reorders, unlike the
// index); rows loaded from the server also keep their `id`, which the PUT body preserves so the
// backend can tell renames from add/remove — new rows simply have no id.
export type DictionaryEntryDraft = {
  key: string;
  id?: number;
  value: string;
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
  return { key: newDraftKey(), value: "" };
}

/** The loaded dictionary -> editable form values. */
export function toFormValues(items: DictionaryEntry[]): DictionaryFormValues {
  return { entries: items.map((e) => ({ key: newDraftKey(), id: e.id, value: e.value })) };
}

/** Form values -> the PUT body (local keys stripped, values trimmed, ids preserved). */
export function toUpdateBody(values: DictionaryFormValues): DictionaryUpdateBody {
  return { items: values.entries.map((e) => ({ id: e.id, value: e.value.trim() })) };
}

/**
 * Mirrors the server's payload rules: non-blank, <=100 chars, and unique after trimming
 * (case-sensitive, like the DB index). The duplicate flag lands on the LATER row so the
 * first occurrence stays valid.
 */
export function dictionaryFormValidation(t: TFunction) {
  return {
    entries: {
      value: (v: string, values: DictionaryFormValues, path: string) => {
        const trimmed = v.trim();
        if (!trimmed) return t("dictionary.valueRequired");
        if (trimmed.length > MAX_DICTIONARY_VALUE_LENGTH) return t("dictionary.valueTooLong");
        const index = Number(path.split(".")[1]);
        const earlier = values.entries.slice(0, index);
        if (earlier.some((e) => e.value.trim() === trimmed)) return t("dictionary.valueDuplicate");
        return null;
      },
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
