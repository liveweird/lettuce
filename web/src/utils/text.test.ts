import { describe, expect, test } from "vitest";
import { foldDiacritics, foldedOptionsFilter } from "./text";

describe("foldDiacritics", () => {
  test("folds every Polish diacritic, both cases", () => {
    expect(foldDiacritics("ąćęłńóśźż")).toBe("acelnoszz");
    expect(foldDiacritics("ĄĆĘŁŃÓŚŹŻ")).toBe("acelnoszz");
    expect(foldDiacritics("Żółw")).toBe("zolw");
  });

  test("folds the non-decomposing letters NFD misses", () => {
    expect(foldDiacritics("łŁ")).toBe("ll");
    expect(foldDiacritics("đĐøØ")).toBe("ddoo");
    expect(foldDiacritics("æÆœŒß")).toBe("aeaeoeoess");
  });

  test("lowercases and passes plain ASCII through unchanged", () => {
    expect(foldDiacritics("Alice Manager")).toBe("alice manager");
    expect(foldDiacritics("a-b_c%1")).toBe("a-b_c%1");
    expect(foldDiacritics("")).toBe("");
  });
});

describe("foldedOptionsFilter", () => {
  const flat = [
    { value: "1", label: "Żółw Kowalski" },
    { value: "2", label: "Zolw Plain" },
    { value: "3", label: "Bob Manager" },
  ];

  test("plain ASCII search matches diacritic labels and vice versa", () => {
    expect(foldedOptionsFilter({ options: flat, search: "zolw", limit: Infinity })).toEqual([
      flat[0],
      flat[1],
    ]);
    expect(foldedOptionsFilter({ options: flat, search: "żółw", limit: Infinity })).toEqual([
      flat[0],
      flat[1],
    ]);
    expect(foldedOptionsFilter({ options: flat, search: "ŻÓŁW KO", limit: Infinity })).toEqual([
      flat[0],
    ]);
  });

  test("keeps the label-contains contract for plain text and trims the search", () => {
    expect(foldedOptionsFilter({ options: flat, search: "  bob ", limit: Infinity })).toEqual([
      flat[2],
    ]);
    expect(foldedOptionsFilter({ options: flat, search: "nope", limit: Infinity })).toEqual([]);
    expect(foldedOptionsFilter({ options: flat, search: "", limit: Infinity })).toEqual(flat);
  });

  test("filters inside groups and drops emptied groups", () => {
    const grouped = [
      { group: "Team A", items: [{ value: "1", label: "Żółw" }] },
      { group: "Team B", items: [{ value: "2", label: "Bob" }] },
    ];
    expect(foldedOptionsFilter({ options: grouped, search: "zolw", limit: Infinity })).toEqual([
      { group: "Team A", items: [{ value: "1", label: "Żółw" }] },
    ]);
  });
});
