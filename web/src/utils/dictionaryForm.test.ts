import { describe, expect, test } from "vitest";
import i18n from "../i18n";
import {
  dictionaryFormValidation,
  emptyEntryDraft,
  toFormValues,
  toUpdateBody,
  type DictionaryFormValues,
} from "./dictionaryForm";

const t = i18n.t.bind(i18n);

describe("dictionaryForm", () => {
  test("toFormValues keeps server ids, fills missing translations as empty, and mints unique local keys", () => {
    const values = toFormValues([
      { id: 5, values: { en: "Engineering", pl: "Inżynieria" } },
      // An EN-only entry (no Polish translation) gets an empty PL input.
      { id: 9, values: { en: "Management" } },
    ]);
    expect(values.entries.map((e) => e.id)).toEqual([5, 9]);
    expect(values.entries.map((e) => e.values.en)).toEqual(["Engineering", "Management"]);
    expect(values.entries.map((e) => e.values.pl)).toEqual(["Inżynieria", ""]);
    const keys = values.entries.map((e) => e.key);
    expect(new Set(keys).size).toBe(2);
  });

  test("toUpdateBody strips keys, trims values, omits blank translations, and leaves new rows id-less", () => {
    const values: DictionaryFormValues = {
      entries: [
        { key: "k1", id: 5, values: { en: "  Engineering  ", pl: " Inżynieria " } },
        // A blank (or whitespace-only) non-EN input means "no translation" — omitted from
        // the wire map, the server's omit-to-clear contract.
        { key: "k2", values: { en: "New path", pl: "   " } },
      ],
    };
    expect(toUpdateBody(values)).toEqual({
      items: [
        { id: 5, values: { en: "Engineering", pl: "Inżynieria" } },
        { id: undefined, values: { en: "New path" } },
      ],
    });
  });

  test("emptyEntryDraft has no id, an empty slot per supported language, and a fresh key", () => {
    const a = emptyEntryDraft();
    const b = emptyEntryDraft();
    expect(a.id).toBeUndefined();
    expect(a.values).toEqual({ en: "", pl: "" });
    expect(a.key).not.toBe(b.key);
  });

  test("validation: EN required, blank non-EN legal, oversized and per-language duplicates flagged on the later row", () => {
    const rules = dictionaryFormValidation(t).entries.values;
    const values: DictionaryFormValues = {
      entries: [
        { key: "k1", id: 1, values: { en: "Engineering", pl: "Inżynieria" } },
        { key: "k2", values: { en: " Engineering ", pl: "Coś innego" } },
      ],
    };

    expect(rules.en("   ", values, "entries.0.values.en")).toBe("Value is required");
    // A blank translation is legal — only English is required.
    expect(rules.pl("   ", values, "entries.1.values.pl")).toBeNull();
    expect(rules.en("x".repeat(101), values, "entries.0.values.en")).toBe(
      "Value must be at most 100 characters",
    );
    expect(rules.pl("x".repeat(101), values, "entries.0.values.pl")).toBe(
      "Value must be at most 100 characters",
    );
    expect(rules.en("x".repeat(100), values, "entries.0.values.en")).toBeNull();
    // The first occurrence stays valid; the later duplicate (even padded) is flagged.
    expect(rules.en("Engineering", values, "entries.0.values.en")).toBeNull();
    expect(rules.en(" Engineering ", values, "entries.1.values.en")).toBe(
      "This value already exists in the dictionary",
    );
    // Uniqueness is per LANGUAGE: a Polish value matching another row's English is fine…
    expect(rules.pl("Engineering", values, "entries.1.values.pl")).toBeNull();
    // …but a Polish duplicate of an earlier row's Polish is not.
    expect(rules.pl(" Inżynieria ", values, "entries.1.values.pl")).toBe(
      "This value already exists in the dictionary",
    );
  });
});
