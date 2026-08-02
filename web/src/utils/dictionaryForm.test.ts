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
  test("toFormValues keeps server ids and mints unique local keys", () => {
    const values = toFormValues([
      { id: 5, value: "Engineering" },
      { id: 9, value: "Management" },
    ]);
    expect(values.entries.map((e) => e.id)).toEqual([5, 9]);
    expect(values.entries.map((e) => e.value)).toEqual(["Engineering", "Management"]);
    const keys = values.entries.map((e) => e.key);
    expect(new Set(keys).size).toBe(2);
  });

  test("toUpdateBody strips keys, trims values, and leaves new rows id-less", () => {
    const values: DictionaryFormValues = {
      entries: [
        { key: "k1", id: 5, value: "  Engineering  " },
        { key: "k2", value: "New path" },
      ],
    };
    expect(toUpdateBody(values)).toEqual({
      items: [
        { id: 5, value: "Engineering" },
        { id: undefined, value: "New path" },
      ],
    });
  });

  test("emptyEntryDraft has no id and a fresh key", () => {
    const a = emptyEntryDraft();
    const b = emptyEntryDraft();
    expect(a.id).toBeUndefined();
    expect(a.value).toBe("");
    expect(a.key).not.toBe(b.key);
  });

  test("validation rejects blank, oversized, and duplicate values (later row flagged)", () => {
    const rule = dictionaryFormValidation(t).entries.value;
    const values: DictionaryFormValues = {
      entries: [
        { key: "k1", id: 1, value: "Engineering" },
        { key: "k2", value: " Engineering " },
      ],
    };

    expect(rule("   ", values, "entries.0.value")).toBe("Value is required");
    expect(rule("x".repeat(101), values, "entries.0.value")).toBe(
      "Value must be at most 100 characters",
    );
    expect(rule("x".repeat(100), values, "entries.0.value")).toBeNull();
    // The first occurrence stays valid; the later duplicate (even padded) is flagged.
    expect(rule("Engineering", values, "entries.0.value")).toBeNull();
    expect(rule(" Engineering ", values, "entries.1.value")).toBe(
      "This value already exists in the dictionary",
    );
  });
});
