import { describe, expect, test } from "vitest";
import i18n from "../i18n";
import {
  dictionaryFormValidation,
  emptyEntryDraft,
  pickDictionaryValue,
  toFormValues,
  toUpdateBody,
  type DictionaryFormValues,
} from "./dictionaryForm";

const t = i18n.t.bind(i18n);

describe("dictionaryForm", () => {
  test("pickDictionaryValue picks the viewer's language, defaulting to English", () => {
    const entry = { valueEn: "Software Engineer", valuePl: "Inżynier oprogramowania" };
    expect(pickDictionaryValue(entry, "en")).toBe("Software Engineer");
    expect(pickDictionaryValue(entry, "pl")).toBe("Inżynier oprogramowania");
    expect(pickDictionaryValue(entry, undefined)).toBe("Software Engineer");
  });

  test("toFormValues keeps server ids and mints unique local keys", () => {
    const values = toFormValues([
      { id: 5, valueEn: "Engineering", valuePl: "Inżynieria" },
      { id: 9, valueEn: "Management", valuePl: "Zarządzanie" },
    ]);
    expect(values.entries.map((e) => e.id)).toEqual([5, 9]);
    expect(values.entries.map((e) => e.valueEn)).toEqual(["Engineering", "Management"]);
    expect(values.entries.map((e) => e.valuePl)).toEqual(["Inżynieria", "Zarządzanie"]);
    const keys = values.entries.map((e) => e.key);
    expect(new Set(keys).size).toBe(2);
  });

  test("toUpdateBody strips keys, trims both values, and leaves new rows id-less", () => {
    const values: DictionaryFormValues = {
      entries: [
        { key: "k1", id: 5, valueEn: "  Engineering  ", valuePl: " Inżynieria " },
        { key: "k2", valueEn: "New path", valuePl: "Nowa ścieżka" },
      ],
    };
    expect(toUpdateBody(values)).toEqual({
      items: [
        { id: 5, valueEn: "Engineering", valuePl: "Inżynieria" },
        { id: undefined, valueEn: "New path", valuePl: "Nowa ścieżka" },
      ],
    });
  });

  test("emptyEntryDraft has no id and a fresh key", () => {
    const a = emptyEntryDraft();
    const b = emptyEntryDraft();
    expect(a.id).toBeUndefined();
    expect(a.valueEn).toBe("");
    expect(a.valuePl).toBe("");
    expect(a.key).not.toBe(b.key);
  });

  test("validation rejects blank, oversized, and per-language duplicate values (later row flagged)", () => {
    const rules = dictionaryFormValidation(t).entries;
    const values: DictionaryFormValues = {
      entries: [
        { key: "k1", id: 1, valueEn: "Engineering", valuePl: "Inżynieria" },
        { key: "k2", valueEn: " Engineering ", valuePl: "Coś innego" },
      ],
    };

    expect(rules.valueEn("   ", values, "entries.0.valueEn")).toBe("Value is required");
    expect(rules.valueEn("x".repeat(101), values, "entries.0.valueEn")).toBe(
      "Value must be at most 100 characters",
    );
    expect(rules.valueEn("x".repeat(100), values, "entries.0.valueEn")).toBeNull();
    // The first occurrence stays valid; the later duplicate (even padded) is flagged.
    expect(rules.valueEn("Engineering", values, "entries.0.valueEn")).toBeNull();
    expect(rules.valueEn(" Engineering ", values, "entries.1.valueEn")).toBe(
      "This value already exists in the dictionary",
    );
    // Uniqueness is per LANGUAGE: a Polish value matching another row's English is fine…
    expect(rules.valuePl("Engineering", values, "entries.1.valuePl")).toBeNull();
    // …but a Polish duplicate of an earlier row's Polish is not.
    expect(rules.valuePl(" Inżynieria ", values, "entries.1.valuePl")).toBe(
      "This value already exists in the dictionary",
    );
  });
});
