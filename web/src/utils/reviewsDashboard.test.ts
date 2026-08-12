import { describe, expect, test } from "vitest";
import type { PerformanceReviewListItem } from "../api/client";
import {
  buildReviewsDashboardRows,
  EMPTY_REVIEWS_DASHBOARD_FILTERS,
  filterReviewsDashboardRows,
  quadrantCellKey,
  quadrantCells,
  ratingDistribution,
  ratingOf,
  sortReviewsDashboardRows,
  teamNameOptions,
} from "./reviewsDashboard";
import type { TeamRow } from "./teamRows";

// teamId derived from the whole name — stable and unique per fixture team name
// (grouping dedupes by teamId since v2.5.4).
function member(userId: number, name: string, teamName: string, overrides: Partial<TeamRow> = {}): TeamRow {
  const teamId = [...teamName].reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 7);
  return { userId, name, email: `${name}@x`, teamId, teamName, ...overrides };
}

function review(subordinateId: number, overrides: Partial<PerformanceReviewListItem> = {}): PerformanceReviewListItem {
  return {
    id: subordinateId * 10,
    managerId: 1,
    managerName: "Mgr",
    managerDeleted: false,
    subordinateId,
    subordinateName: `S${subordinateId}`,
    subordinateDeleted: false,
    periodId: 4,
    periodStartMonth: "2026-01",
    periodEndMonth: "2026-06",
    status: "DRAFT",
    attitudeRating: 3,
    deliveryRating: null,
    skillsRating: null,
    overallRating: null,
    createdAt: 1,
    lastModified: 1,
    ...overrides,
  };
}

describe("reviewsDashboard", () => {
  test("joins one row per person (multi-team memberships deduped), sorted by name", () => {
    const rows = buildReviewsDashboardRows(
      [member(2, "Zoe", "AAA"), member(1, "Ann", "AAA"), member(1, "Ann", "BBB")],
      [review(1)],
    );
    expect(rows.map((r) => r.person.name)).toEqual(["Ann", "Zoe"]);
    expect(rows[0].person.teamNames).toEqual(["AAA", "BBB"]);
    expect(rows[0].review?.id).toBe(10);
    // Zoe has no review for the period — the "no review yet" state.
    expect(rows[1].review).toBeNull();
  });

  test("filters narrow by team name and career entry ids", () => {
    const rows = buildReviewsDashboardRows(
      [
        member(1, "Ann", "AAA", { careerPath: { id: 11, valueEn: "Eng", valuePl: "Eng" } }),
        member(2, "Zoe", "BBB", { seniorityLevel: { id: 31, valueEn: "Senior", valuePl: "Senior" } }),
      ],
      [],
    );
    expect(filterReviewsDashboardRows(rows, EMPTY_REVIEWS_DASHBOARD_FILTERS)).toHaveLength(2);
    expect(
      filterReviewsDashboardRows(rows, { ...EMPTY_REVIEWS_DASHBOARD_FILTERS, teamName: "BBB" })
        .map((r) => r.person.name),
    ).toEqual(["Zoe"]);
    expect(
      filterReviewsDashboardRows(rows, { ...EMPTY_REVIEWS_DASHBOARD_FILTERS, careerPathId: "11" })
        .map((r) => r.person.name),
    ).toEqual(["Ann"]);
    // An unset career value never matches a concrete filter.
    expect(
      filterReviewsDashboardRows(rows, {
        ...EMPTY_REVIEWS_DASHBOARD_FILTERS,
        careerSpecializationId: "21",
      }),
    ).toEqual([]);
    expect(
      filterReviewsDashboardRows(rows, {
        ...EMPTY_REVIEWS_DASHBOARD_FILTERS,
        seniorityLevelId: "31",
      }).map((r) => r.person.name),
    ).toEqual(["Zoe"]);
  });

  test("sorts strings per locale with unset values last", () => {
    const rows = buildReviewsDashboardRows(
      [
        member(1, "Ann", "BBB", { seniorityLevel: { id: 31, valueEn: "Senior", valuePl: "Senior" } }),
        member(2, "Zoe", "AAA"),
      ],
      [],
    );
    expect(sortReviewsDashboardRows(rows, "team", "asc").map((r) => r.person.name)).toEqual([
      "Zoe",
      "Ann",
    ]);
    expect(sortReviewsDashboardRows(rows, "name", "desc").map((r) => r.person.name)).toEqual([
      "Zoe",
      "Ann",
    ]);
    // Zoe has no seniority — she sinks below Ann in BOTH directions.
    expect(
      sortReviewsDashboardRows(rows, "seniorityLevel", "asc").map((r) => r.person.name),
    ).toEqual(["Ann", "Zoe"]);
    expect(
      sortReviewsDashboardRows(rows, "seniorityLevel", "desc").map((r) => r.person.name),
    ).toEqual(["Ann", "Zoe"]);
  });

  test("sorts ratings numerically with no-review rows last regardless of direction", () => {
    const rows = buildReviewsDashboardRows(
      [member(1, "Ann", "AAA"), member(2, "Ben", "AAA"), member(3, "Zoe", "AAA")],
      [review(1, { overallRating: 2 }), review(2, { overallRating: 5 })],
    );
    expect(sortReviewsDashboardRows(rows, "overall", "asc").map((r) => r.person.name)).toEqual([
      "Ann",
      "Ben",
      "Zoe",
    ]);
    expect(sortReviewsDashboardRows(rows, "overall", "desc").map((r) => r.person.name)).toEqual([
      "Ben",
      "Ann",
      "Zoe",
    ]);
  });

  test("sorts status by lifecycle rank, no review lowest", () => {
    const rows = buildReviewsDashboardRows(
      [member(1, "Ann", "A"), member(2, "Ben", "A"), member(3, "Cyd", "A"), member(4, "Zoe", "A")],
      [
        review(1, { status: "PUBLISHED" }),
        review(2, { status: "DRAFT" }),
        review(3, { status: "CALIBRATION" }),
      ],
    );
    expect(sortReviewsDashboardRows(rows, "status", "asc").map((r) => r.person.name)).toEqual([
      "Zoe", // no review
      "Ben", // draft
      "Cyd", // calibration
      "Ann", // published
    ]);
    expect(sortReviewsDashboardRows(rows, "status", "desc").map((r) => r.person.name)).toEqual([
      "Ann",
      "Cyd",
      "Ben",
      "Zoe",
    ]);
  });

  test("teamNameOptions collects the distinct sorted team names", () => {
    const rows = buildReviewsDashboardRows(
      [member(1, "Ann", "BBB"), member(1, "Ann", "AAA"), member(2, "Zoe", "BBB")],
      [],
    );
    expect(teamNameOptions(rows)).toEqual(["AAA", "BBB"]);
  });

  test("ratingDistribution zero-fills all six buckets and counts per category", () => {
    const rows = buildReviewsDashboardRows(
      [member(1, "Ann", "AAA"), member(2, "Bob", "AAA"), member(3, "Cee", "AAA")],
      [
        review(1, { attitudeRating: 4, overallRating: 6 }),
        review(2, { attitudeRating: 4, overallRating: null }),
      ],
    );
    const attitude = ratingDistribution(rows, "attitude");
    expect(attitude.counts).toEqual([
      { rating: 1, count: 0 },
      { rating: 2, count: 0 },
      { rating: 3, count: 0 },
      { rating: 4, count: 2 },
      { rating: 5, count: 0 },
      { rating: 6, count: 0 },
    ]);
    expect(attitude.rated).toBe(2);
    expect(attitude.total).toBe(3); // Cee has no review — counted in total only

    const overall = ratingDistribution(rows, "overall");
    expect(overall.counts.find((b) => b.rating === 6)?.count).toBe(1);
    expect(overall.rated).toBe(1); // Bob's overall is unset — excluded per category
  });

  test("ratingDistribution with no rated rows reports rated 0 and all-zero buckets", () => {
    const rows = buildReviewsDashboardRows([member(1, "Ann", "AAA")], []);
    const dist = ratingDistribution(rows, "skills");
    expect(dist.rated).toBe(0);
    expect(dist.total).toBe(1);
    expect(dist.counts.every((b) => b.count === 0)).toBe(true);
  });

  test("ratingOf reads the picked category's rating (null for no review or unset)", () => {
    const rows = buildReviewsDashboardRows(
      [member(1, "Ann", "AAA"), member(2, "Bob", "AAA")],
      [review(1, { attitudeRating: 5, deliveryRating: null })],
    );
    expect(ratingOf(rows[0], "attitude")).toBe(5);
    expect(ratingOf(rows[0], "delivery")).toBeNull();
    expect(ratingOf(rows[1], "overall")).toBeNull(); // Bob has no review at all
  });

  test("quadrantCells groups same-coordinate people in one cell, name-ordered", () => {
    const rows = buildReviewsDashboardRows(
      [member(1, "Zoe", "AAA"), member(2, "Ann", "AAA"), member(3, "Bob", "AAA")],
      [
        review(1, { deliveryRating: 4, attitudeRating: 2 }),
        review(2, { deliveryRating: 4, attitudeRating: 2 }),
        review(3, { deliveryRating: 1, attitudeRating: 6 }),
      ],
    );
    const { cells, unrated } = quadrantCells(rows, "delivery", "attitude");
    expect(unrated).toEqual([]);
    expect(cells.get(quadrantCellKey(4, 2))?.map((p) => p.name)).toEqual(["Ann", "Zoe"]);
    expect(cells.get(quadrantCellKey(1, 6))?.map((p) => p.name)).toEqual(["Bob"]);
    expect(cells.size).toBe(2);
  });

  test("quadrantCells sends no-review and either-axis-unset rows to unrated, never the plane", () => {
    const rows = buildReviewsDashboardRows(
      [member(1, "Ann", "AAA"), member(2, "Bob", "AAA"), member(3, "Cee", "AAA")],
      [
        review(1, { skillsRating: 3, overallRating: 5 }),
        review(2, { skillsRating: 3, overallRating: null }), // one axis unset
      ],
    );
    const { cells, unrated } = quadrantCells(rows, "skills", "overall");
    expect(cells.get(quadrantCellKey(3, 5))?.map((p) => p.name)).toEqual(["Ann"]);
    expect(unrated.map((p) => p.name)).toEqual(["Bob", "Cee"]);
    // The same rows plotted on axes both present for Bob put him back on the plane.
    const swapped = quadrantCells(rows, "attitude", "skills");
    expect(swapped.cells.get(quadrantCellKey(3, 3))?.map((p) => p.name)).toEqual(["Ann", "Bob"]);
    expect(swapped.unrated.map((p) => p.name)).toEqual(["Cee"]);
  });
});
