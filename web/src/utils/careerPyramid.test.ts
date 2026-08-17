import { describe, expect, test } from "vitest";
import type { CareerPyramidItem } from "../api/career";
import {
  CAREER_PYRAMID_SORT_FIELDS,
  EMPTY_CAREER_PYRAMID_FILTERS,
  NOT_SET,
  buildCareerDistribution,
  buildCareerPyramidRows,
  filterCareerPyramidRows,
  formatTenure,
  monthsBetween,
  sortCareerPyramidRows,
  tenureBucket,
} from "./careerPyramid";

const ENTRY = (id: number, en: string, pl = en) => ({ id, values: { en: en, pl: pl } });

// Full-history items (v2.17.0) whose TODAY view matches the original v2.16.0 fixture: the
// as-of pipeline must land on the same current triples and anchors the flat payload carried.
const ITEMS: CareerPyramidItem[] = [
  {
    userId: 1,
    name: "Żaneta Boss",
    deactivated: false,
    positions: [
      {
        startDate: "2015-01-01",
        endDate: "2023-03-09",
        careerPath: ENTRY(11, "Engineer", "Inżynier"),
        careerSpecialization: ENTRY(21, "Backend"),
        seniorityLevel: ENTRY(30, "Regular"),
      },
      {
        startDate: "2023-03-10",
        endDate: null,
        careerPath: ENTRY(11, "Engineer", "Inżynier"),
        careerSpecialization: ENTRY(21, "Backend"),
        seniorityLevel: ENTRY(31, "Senior"),
      },
    ],
  },
  {
    userId: 2,
    name: "adam nowak",
    deactivated: false,
    positions: [
      {
        startDate: "2024-11-20",
        endDate: null,
        careerPath: ENTRY(12, "Manager"),
        careerSpecialization: null,
        seniorityLevel: ENTRY(31, "Senior"),
      },
    ],
  },
  { userId: 3, name: "Bare Person", deactivated: false, positions: [] },
];

const TODAY = "2026-08-15";
const rows = () => buildCareerPyramidRows(ITEMS, "en", TODAY);

describe("monthsBetween", () => {
  test("counts whole calendar months, day-aware", () => {
    expect(monthsBetween("2026-06-15", "2026-08-15")).toBe(2);
    expect(monthsBetween("2026-06-16", "2026-08-15")).toBe(1); // day not reached yet
    expect(monthsBetween("2025-08-15", "2026-08-15")).toBe(12);
    expect(monthsBetween("2026-08-01", "2026-08-15")).toBe(0);
    expect(monthsBetween("2026-09-01", "2026-08-15")).toBe(0); // future-proof floor
  });
});

describe("buildCareerPyramidRows", () => {
  test("resolves locale texts and derives tenure months; missing data stays null", () => {
    const [boss, , bare] = rows();
    expect(boss.pathText).toBe("Engineer");
    expect(boss.levelMonths).toBe(41); // 2023-03-10 → 2026-08-15
    expect(boss.organizationMonths).toBe(139); // 2015-01-01 → 2026-08-15
    expect(bare.pathText).toBeNull();
    expect(bare.levelMonths).toBeNull();
    expect(bare.organizationMonths).toBeNull();
  });

  test("the PL locale picks the Polish value", () => {
    expect(buildCareerPyramidRows(ITEMS, "pl", TODAY)[0].pathText).toBe("Inżynier");
  });

  test("a missing translation falls back to English for that locale", () => {
    const items: CareerPyramidItem[] = [
      {
        userId: 9,
        name: "Fallback Case",
        deactivated: false,
        positions: [
          {
            startDate: "2020-01-01",
            endDate: null,
            // No Polish translation on the path entry (EN-only values map).
            careerPath: { id: 90, values: { en: "Consultant" } },
            careerSpecialization: null,
            seniorityLevel: null,
          },
        ],
      },
    ];
    expect(buildCareerPyramidRows(items, "pl", TODAY)[0].pathText).toBe("Consultant");
  });
});

describe("time travel (as-of)", () => {
  test("a past date lands on the historical position and re-anchors both tenures", () => {
    const [boss] = buildCareerPyramidRows(ITEMS, "en", "2020-01-01");
    expect(boss.seniorityText).toBe("Regular"); // the pre-promotion position
    expect(boss.currentPositionStart).toBe("2015-01-01");
    expect(boss.levelMonths).toBe(60); // 2015-01-01 → 2020-01-01
    expect(boss.organizationMonths).toBe(60);
  });

  test("an ACTIVE person before their first position shows as Not set with no org tenure", () => {
    const past = buildCareerPyramidRows(ITEMS, "en", "2020-01-01");
    const adam = past.find((r) => r.userId === 2);
    expect(adam).toBeDefined(); // active → kept as a "Not set" row
    expect(adam?.seniorityText).toBeNull();
    expect(adam?.levelMonths).toBeNull();
    expect(adam?.organizationSince).toBeNull(); // not in the org yet as recorded
  });

  test("a DEACTIVATED person is listed only while they actively held a position (end inclusive)", () => {
    const gone: CareerPyramidItem = {
      userId: 9,
      name: "Gone Person",
      deactivated: true,
      positions: [
        {
          startDate: "2024-01-01",
          endDate: "2026-08-10", // the deactivation stamp
          careerPath: ENTRY(11, "Engineer"),
          careerSpecialization: ENTRY(21, "Backend"),
          seniorityLevel: ENTRY(31, "Senior"),
        },
      ],
    };
    const at = (asOf: string) => buildCareerPyramidRows([gone], "en", asOf);
    expect(at("2026-08-10")).toHaveLength(1); // the deactivation day itself still shows
    expect(at("2026-08-10")[0].seniorityText).toBe("Senior");
    expect(at("2026-08-11")).toHaveLength(0); // the day after: dropped, never "Not set"
    expect(at("2023-12-31")).toHaveLength(0); // before their first position: dropped too
  });

  test("a deactivated person with no positions at all never shows", () => {
    const bareGone: CareerPyramidItem = { userId: 8, name: "X", deactivated: true, positions: [] };
    expect(buildCareerPyramidRows([bareGone], "en", TODAY)).toHaveLength(0);
    expect(buildCareerPyramidRows([bareGone], "en", "2015-06-01")).toHaveLength(0);
  });
});

describe("filterCareerPyramidRows", () => {
  test("name matches accent- and case-insensitively", () => {
    const out = filterCareerPyramidRows(rows(), { ...EMPTY_CAREER_PYRAMID_FILTERS, name: "zaneta" });
    expect(out.map((r) => r.userId)).toEqual([1]);
  });

  test("entry-id filters match by id; NOT_SET matches the missing value", () => {
    expect(
      filterCareerPyramidRows(rows(), { ...EMPTY_CAREER_PYRAMID_FILTERS, careerPathId: "12" }).map(
        (r) => r.userId,
      ),
    ).toEqual([2]);
    expect(
      filterCareerPyramidRows(rows(), {
        ...EMPTY_CAREER_PYRAMID_FILTERS,
        careerSpecializationId: NOT_SET,
      }).map((r) => r.userId),
    ).toEqual([2, 3]);
  });
});

describe("sortCareerPyramidRows", () => {
  test("tenure fields sort by the underlying date with nulls last in both directions", () => {
    const asc = sortCareerPyramidRows(rows(), "levelSince", "asc");
    expect(asc.map((r) => r.userId)).toEqual([1, 2, 3]); // earliest start (longest tenure) first
    const desc = sortCareerPyramidRows(rows(), "levelSince", "desc");
    expect(desc.map((r) => r.userId)).toEqual([2, 1, 3]); // nulls STILL last
  });

  test("every whitelisted field sorts without throwing", () => {
    for (const field of CAREER_PYRAMID_SORT_FIELDS) {
      expect(() => sortCareerPyramidRows(rows(), field, "asc")).not.toThrow();
    }
  });
});

describe("tenure formatting and buckets", () => {
  test("formatTenure composes localized years and months", () => {
    const t = (key: string, opts?: { count?: number }) =>
      key === "career.tenure.year"
        ? `${opts?.count}y`
        : key === "career.tenure.month"
          ? `${opts?.count}m`
          : key;
    expect(formatTenure(0, t as never)).toBe("career.tenure.underMonth");
    expect(formatTenure(5, t as never)).toBe("5m");
    expect(formatTenure(24, t as never)).toBe("2y");
    expect(formatTenure(41, t as never)).toBe("3y 5m");
  });

  test("tenureBucket boundaries", () => {
    expect(tenureBucket(0)).toBe("lt1");
    expect(tenureBucket(11)).toBe("lt1");
    expect(tenureBucket(12)).toBe("y1to2");
    expect(tenureBucket(24)).toBe("y2to5");
    expect(tenureBucket(59)).toBe("y2to5");
    expect(tenureBucket(60)).toBe("y5to10");
    expect(tenureBucket(120)).toBe("y10plus");
  });
});

describe("buildCareerDistribution", () => {
  test("categorical: count-descending with Not set last, empty values dropped", () => {
    expect(buildCareerDistribution(rows(), "seniorityLevel")).toEqual([
      { key: "Senior", count: 2 },
      { key: NOT_SET, count: 1 },
    ]);
    expect(buildCareerDistribution(rows(), "careerPath")).toEqual([
      { key: "Engineer", count: 1 },
      { key: "Manager", count: 1 },
      { key: NOT_SET, count: 1 },
    ]);
  });

  test("tenure: the fixed bucket order is kept, empty buckets included, Not set last", () => {
    expect(buildCareerDistribution(rows(), "tenureAtLevel")).toEqual([
      { key: "lt1", count: 0 },
      { key: "y1to2", count: 1 }, // adam: 2024-11-20 → 21 months
      { key: "y2to5", count: 1 }, // boss: 41 months
      { key: "y5to10", count: 0 },
      { key: "y10plus", count: 0 },
      { key: NOT_SET, count: 1 },
    ]);
    expect(buildCareerDistribution(rows(), "tenureInOrganization")).toEqual([
      { key: "lt1", count: 0 },
      { key: "y1to2", count: 1 },
      { key: "y2to5", count: 0 },
      { key: "y5to10", count: 0 },
      { key: "y10plus", count: 1 }, // boss: 139 months
      { key: NOT_SET, count: 1 },
    ]);
  });

  test("no Not-set bar when everyone has the value", () => {
    const complete = buildCareerDistribution(rows().slice(0, 2), "seniorityLevel");
    expect(complete).toEqual([{ key: "Senior", count: 2 }]);
  });
});
