import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Guards EN↔PL translation parity so the two languages can't silently drift. Reads the JSON off
// disk (independent of i18n init) and auto-discovers area files — a new en/foo.json with no
// pl/foo.json fails here rather than shipping half-translated. Mirrors the manual review checks.
// vitest runs with cwd = the web/ project root.

const EN_DIR = resolve(process.cwd(), "src/locales/en");
const PL_DIR = resolve(process.cwd(), "src/locales/pl");

// CLDR plural categories: i18next appends `_<category>` (English uses one/other; Polish adds
// few/many). Stripping the suffix compares the base concept, so PL-only `unread_few`/`_many`
// are not mistaken for missing keys — but a genuinely absent key still is.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

type Json = Record<string, unknown>;

function areaFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

function load(dir: string, area: string): Json {
  return JSON.parse(readFileSync(`${dir}/${area}.json`, "utf8")) as Json;
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

const EN_AREAS = areaFiles(EN_DIR);
const PL_AREAS = areaFiles(PL_DIR);
const SHARED = EN_AREAS.filter((a) => PL_AREAS.includes(a));

describe("EN/PL locale parity", () => {
  it("has the same set of area files in both languages", () => {
    expect(PL_AREAS).toEqual(EN_AREAS);
  });

  it.each(SHARED)("%s.json — every key exists in both languages (plural-aware)", (area) => {
    const en = flatten(load(EN_DIR, area));
    const pl = flatten(load(PL_DIR, area));
    const enBases = new Set(Object.keys(en).map(base));
    const plBases = new Set(Object.keys(pl).map(base));

    const missingInPl = [...enBases].filter((k) => !plBases.has(k)).sort();
    const missingInEn = [...plBases].filter((k) => !enBases.has(k)).sort();

    expect(missingInPl, `keys present in en/${area} but missing in pl/${area}`).toEqual([]);
    expect(missingInEn, `keys present in pl/${area} but missing in en/${area}`).toEqual([]);
  });

  it.each(SHARED)("%s.json — placeholders match across languages", (area) => {
    const en = flatten(load(EN_DIR, area));
    const pl = flatten(load(PL_DIR, area));

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
    for (const [lang, dir] of [["en", EN_DIR], ["pl", PL_DIR]] as const) {
      const flat = flatten(load(dir, area));
      for (const [k, v] of Object.entries(flat)) {
        if (v === "") empties.push(`${lang}/${area}:${k}`);
      }
    }
    expect(empties, "empty translation values").toEqual([]);
  });
});
