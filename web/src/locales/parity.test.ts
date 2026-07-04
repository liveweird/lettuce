import { describe, expect, it } from "vitest";

// Guards EN↔PL translation parity so the two languages can't silently drift. Loads every locale
// JSON via Vite's import.meta.glob (build-time expanded — no fs/node types, auto-discovers new
// area files), so a new en/foo.json with no pl/foo.json fails here rather than shipping
// half-translated. Mirrors the manual review checks: key parity, placeholders, empties.

type Json = Record<string, unknown>;
type JsonModule = { default: Json };

const EN_MODULES = import.meta.glob<JsonModule>("./en/*.json", { eager: true });
const PL_MODULES = import.meta.glob<JsonModule>("./pl/*.json", { eager: true });

// CLDR plural categories: i18next appends `_<category>` (English uses one/other; Polish adds
// few/many). Stripping the suffix compares the base concept, so PL-only `unread_few`/`_many`
// are not mistaken for missing keys — but a genuinely absent key still is.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function areaMap(modules: Record<string, JsonModule>): Map<string, Json> {
  const m = new Map<string, Json>();
  for (const [path, mod] of Object.entries(modules)) {
    const area = path.split("/").pop()!.replace(/\.json$/, "");
    m.set(area, mod.default);
  }
  return m;
}

// Flatten nested objects to dot-paths → leaf string values.
function flatten(obj: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (obj !== null && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Json)) {
      Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
    }
  } else {
    out[prefix] = String(obj);
  }
  return out;
}

const base = (key: string): string => key.replace(PLURAL_SUFFIX, "");
const placeholders = (s: string): Set<string> =>
  new Set([...s.matchAll(/{{\s*([\w.]+)/g)].map((m) => m[1]));

const EN = areaMap(EN_MODULES);
const PL = areaMap(PL_MODULES);
const EN_AREAS = [...EN.keys()].sort();
const PL_AREAS = [...PL.keys()].sort();
const SHARED = EN_AREAS.filter((a) => PL.has(a));

describe("EN/PL locale parity", () => {
  it("has the same set of area files in both languages", () => {
    expect(PL_AREAS).toEqual(EN_AREAS);
  });

  it.each(SHARED)("%s.json — every key exists in both languages (plural-aware)", (area) => {
    const en = flatten(EN.get(area));
    const pl = flatten(PL.get(area));
    const enBases = new Set(Object.keys(en).map(base));
    const plBases = new Set(Object.keys(pl).map(base));

    const missingInPl = [...enBases].filter((k) => !plBases.has(k)).sort();
    const missingInEn = [...plBases].filter((k) => !enBases.has(k)).sort();

    expect(missingInPl, `keys present in en/${area} but missing in pl/${area}`).toEqual([]);
    expect(missingInEn, `keys present in pl/${area} but missing in en/${area}`).toEqual([]);
  });

  it.each(SHARED)("%s.json — placeholders match across languages", (area) => {
    const en = flatten(EN.get(area));
    const pl = flatten(PL.get(area));

    // Compare the {{token}} set per base-key family (covers plural forms too).
    const family = (flat: Record<string, string>): Map<string, Set<string>> => {
      const m = new Map<string, Set<string>>();
      for (const [k, v] of Object.entries(flat)) {
        const set = m.get(base(k)) ?? new Set<string>();
        placeholders(v).forEach((p) => set.add(p));
        m.set(base(k), set);
      }
      return m;
    };
    const enFam = family(en);
    const plFam = family(pl);

    const mismatches: string[] = [];
    for (const [key, enSet] of enFam) {
      const plSet = plFam.get(key) ?? new Set<string>();
      const enSorted = [...enSet].sort();
      const plSorted = [...plSet].sort();
      if (JSON.stringify(enSorted) !== JSON.stringify(plSorted)) {
        mismatches.push(`${area}:${key} — en{${enSorted}} vs pl{${plSorted}}`);
      }
    }
    expect(mismatches, "placeholder token mismatches").toEqual([]);
  });

  it.each(SHARED)("%s.json — no empty string values in either language", (area) => {
    const empties: string[] = [];
    for (const [lang, map] of [["en", EN], ["pl", PL]] as const) {
      const flat = flatten(map.get(area));
      for (const [k, v] of Object.entries(flat)) {
        if (v === "") empties.push(`${lang}/${area}:${k}`);
      }
    }
    expect(empties, "empty translation values").toEqual([]);
  });
});
